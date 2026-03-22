"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, FileText, Settings, ArrowLeft, Plus, X, Search, Loader2, Trash } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
    SheetTrigger, SheetClose
} from "@/components/ui/sheet";
import { useState, useEffect, use, useCallback, useRef } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { useRouter } from "next/navigation";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";

// ── Types ──
interface StudentItem {
    id: string;
    name: string;
    email: string;
    status: string;
}

interface AssignmentItem {
    id: string;
    testId: string;
    test: { id: string; title: string; status: string; durationMinutes: number };
}

interface BatchData {
    id: string;
    name: string;
    code: string;
    kind: "FREE_SYSTEM" | "STANDARD";
    status: string;
    students: StudentItem[];
    assignments: AssignmentItem[];
    studentCount: number;
    assignmentCount: number;
}

export default function BatchDetailsPage({ params }: { params: Promise<{ batchId: string }> }) {
    const { batchId } = use(params);
    const router = useRouter();

    const [isLoading, setIsLoading] = useState(true);
    const [batch, setBatch] = useState<BatchData | null>(null);

    // Settings sheet
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editName, setEditName] = useState("");
    const [editCode, setEditCode] = useState("");
    const [editStatus, setEditStatus] = useState("");

    // Add student sheet — paginated + debounced server-side search
    const [addStudentOpen, setAddStudentOpen] = useState(false);
    const [studentSearch, setStudentSearch] = useState("");
    const [availableStudents, setAvailableStudents] = useState<StudentItem[]>([]);
    const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
    const [enrolling, setEnrolling] = useState(false);
    const [loadingStudents, setLoadingStudents] = useState(false);
    const [studentPage, setStudentPage] = useState(1);
    const [hasMoreStudents, setHasMoreStudents] = useState(false);
    const [totalAvailable, setTotalAvailable] = useState(0);
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

    // Delete
    const [deleteOpen, setDeleteOpen] = useState(false);

    // ── Fetch batch data ──
    const fetchBatch = useCallback(async () => {
        const res = await apiClient.get<{ batch: BatchData }>(`/api/admin/batches/${batchId}`);
        if (res.ok) {
            setBatch(res.data.batch);
        } else {
            toast.error("Failed to load batch");
        }
        setIsLoading(false);
    }, [batchId]);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial data fetch
        fetchBatch();
    }, [fetchBatch]);

    // Populate edit form when settings opens
    useEffect(() => {
        if (settingsOpen && batch) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form state with batch data
            setEditName(batch.name);
            setEditCode(batch.code);
            setEditStatus(batch.status);
        }
    }, [settingsOpen, batch]);

    // ── Sliding window student fetcher (paginated, 20 at a time) ──
    const fetchStudents = useCallback(async (search: string, page: number, append: boolean = false) => {
        setLoadingStudents(true);
        const enrolledIds = batch?.students.map(s => s.id) || [];

        const res = await apiClient.get<{ users: StudentItem[]; total: number; totalPages: number }>(
            "/api/admin/users",
            { role: "STUDENT", search: search || undefined, page, limit: 20 }
        );
        if (res.ok) {
            // Filter out already-enrolled students client-side
            const filtered = res.data.users.filter(s => !enrolledIds.includes(s.id));
            if (append) {
                setAvailableStudents(prev => [...prev, ...filtered]);
            } else {
                setAvailableStudents(filtered);
            }
            setTotalAvailable(res.data.total);
            setHasMoreStudents(page < res.data.totalPages);
        }
        setLoadingStudents(false);
    }, [batch]);

    // When Add Student sheet opens, fetch page 1
    useEffect(() => {
        if (addStudentOpen && batch) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- sync search/pagination state when sheet opens
            setStudentSearch("");
            setStudentPage(1);
            setSelectedStudents(new Set());
            fetchStudents("", 1, false);
        }
    }, [addStudentOpen, batch, fetchStudents]);

    // Debounced search — only calls API after 400ms pause
    const handleStudentSearch = (value: string) => {
        setStudentSearch(value);
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            setStudentPage(1);
            fetchStudents(value, 1, false);
        }, 400);
    };

    // Load more (sliding window)
    const loadMoreStudents = () => {
        const nextPage = studentPage + 1;
        setStudentPage(nextPage);
        fetchStudents(studentSearch, nextPage, true);
    };

    // ── Handlers ──
    const handleSaveSettings = async () => {
        if (batch?.kind === "FREE_SYSTEM") {
            toast.info("System Batch Locked", { description: "The free-mock system batch cannot be renamed or disabled." });
            return;
        }

        setSaving(true);
        const body: Record<string, string> = {};
        if (editName !== batch?.name) body.name = editName;
        if (editCode !== batch?.code) body.code = editCode.toUpperCase();
        if (editStatus !== batch?.status) body.status = editStatus;

        if (Object.keys(body).length === 0) {
            toast.info("No changes to save");
            setSaving(false);
            return;
        }

        const res = await apiClient.patch(`/api/admin/batches/${batchId}`, body);
        if (res.ok) {
            toast.success("Settings Saved");
            setSettingsOpen(false);
            fetchBatch();
        } else {
            toast.error("Failed to save", { description: res.message });
        }
        setSaving(false);
    };

    const handleEnrollStudents = async () => {
        if (selectedStudents.size === 0) return;
        setEnrolling(true);
        const res = await apiClient.post(`/api/admin/batches/${batchId}/students`, {
            studentIds: Array.from(selectedStudents),
        });
        if (res.ok) {
            const data = res.data as { added: number; skipped: number };
            toast.success(`${data.added} student(s) enrolled`, {
                description: data.skipped > 0 ? `${data.skipped} already enrolled` : undefined,
            });
            setAddStudentOpen(false);
            fetchBatch();
        } else {
            toast.error("Failed to enroll", { description: res.message });
        }
        setEnrolling(false);
    };

    const handleUnenroll = async (studentId: string, studentName: string) => {
        const res = await apiClient.delete(`/api/admin/batches/${batchId}/students?studentId=${studentId}`);
        if (res.ok) {
            toast.success(`${studentName} removed`);
            fetchBatch();
        } else {
            toast.error("Failed to remove student");
        }
    };

    const handleDisableBatch = async () => {
        const res = await apiClient.patch(`/api/admin/batches/${batchId}`, { status: "COMPLETED" });
        if (res.ok) {
            toast.success("Batch disabled");
            router.push("/admin/batches");
        } else {
            toast.error("Failed to disable batch");
        }
    };

    const handlePermanentDelete = async () => {
        const res = await apiClient.delete(`/api/admin/batches/${batchId}?permanent=true`);
        if (res.ok) {
            toast.success("Batch permanently deleted");
            router.push("/admin/batches");
        } else {
            toast.error("Failed to delete", { description: res.message });
        }
    };

    const toggleStudent = (id: string) => {
        setSelectedStudents(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const statusBadge = (status: string) => {
        const s = status.toLowerCase();
        if (s === "active") return "bg-indigo-50 text-indigo-700";
        if (s === "completed") return "bg-emerald-50 text-emerald-700";
        if (s === "published") return "bg-emerald-50 text-emerald-700";
        if (s === "draft") return "bg-amber-50 text-amber-700";
        return "bg-amber-50 text-amber-700";
    };

    // ── Loading State ──
    if (isLoading) {
        return (
            <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
                <Skeleton className="h-4 w-28 rounded-md" />
                <Skeleton className="h-9 w-64 rounded-md" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-3xl" />)}
                </div>
                <Skeleton className="h-64 rounded-3xl" />
            </div>
        );
    }

    if (!batch) {
        return (
            <div className="flex flex-col items-center py-20">
                <h2 className="text-xl font-serif font-bold text-slate-900 mb-2">Batch Not Found</h2>
                <Button asChild variant="outline"><Link href="/admin/batches">Back to Batches</Link></Button>
            </div>
        );
    }

    const isSystemBatch = batch.kind === "FREE_SYSTEM";

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b pb-6 gap-4" style={{ borderColor: "var(--border-soft)" }}>
                <div>
                    <Link href="/admin/batches" className="inline-flex items-center text-sm font-bold text-primary hover:underline mb-2">
                        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Batches
                    </Link>
                    <div className="flex items-center gap-3 flex-wrap">
                        <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">{batch.name}</h1>
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-none px-2 py-0.5 text-xs">{batch.code}</Badge>
                        <Badge variant="outline" className={`border-none px-2 py-0.5 text-xs ${isSystemBatch ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                            {isSystemBatch ? "Free System Batch" : "Paid Batch"}
                        </Badge>
                        <Badge variant="outline" className={`border-none font-bold uppercase tracking-wider text-[10px] px-2.5 py-1 ${statusBadge(batch.status)}`}>
                            {batch.status}
                        </Badge>
                    </div>
                    <p className="text-slate-500 mt-1 font-medium">
                        {isSystemBatch ? "Reserved for public free mocks and lead capture" : `${batch.studentCount} Students Enrolled`}
                    </p>
                </div>
                <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
                    <SheetTrigger asChild>
                        <Button className="bg-surface-2 hover:bg-white text-slate-700 font-bold border-transparent rounded-xl shadow-sm h-11">
                            <Settings className="w-4 h-4 mr-2" /> Manage Settings
                        </Button>
                    </SheetTrigger>
                    <SheetContent className="border-l-0 shadow-clay-outer p-0 sm:max-w-md w-full flex flex-col">
                        <div className="p-6 border-b" style={{ borderColor: "var(--border-soft)" }}>
                            <SheetHeader>
                                <SheetTitle className="font-serif text-2xl text-slate-900">Batch Settings</SheetTitle>
                                <SheetDescription>
                                    {isSystemBatch
                                        ? "The free-mock system batch is locked to protect public test routing."
                                        : "Edit batch name, code, and status."}
                                </SheetDescription>
                            </SheetHeader>
                        </div>
                        <div className="p-6 flex-1 overflow-auto grid gap-6 content-start">
                            <div className="grid gap-2">
                                <Label className="font-bold text-slate-700">Batch Name</Label>
                                <Input value={editName} onChange={e => setEditName(e.target.value)} disabled={isSystemBatch} className="rounded-xl h-11 bg-surface-2 border-transparent disabled:bg-slate-100" />
                            </div>
                            <div className="grid gap-2">
                                <Label className="font-bold text-slate-700">Batch Code</Label>
                                <Input value={editCode} onChange={e => setEditCode(e.target.value)} disabled={isSystemBatch} className="rounded-xl h-11 bg-surface-2 border-transparent disabled:bg-slate-100" />
                            </div>
                            <div className="grid gap-2">
                                <Label className="font-bold text-slate-700">Status</Label>
                                <Select value={editStatus} onValueChange={setEditStatus} disabled={isSystemBatch}>
                                    <SelectTrigger className="rounded-xl h-11 bg-surface-2 border-transparent">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="rounded-xl">
                                        <SelectItem value="ACTIVE">Active</SelectItem>
                                        <SelectItem value="UPCOMING">Upcoming</SelectItem>
                                        <SelectItem value="COMPLETED">Completed</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {isSystemBatch ? null : (
                                <div className="border-t pt-6 mt-4" style={{ borderColor: "var(--border-soft)" }}>
                                    <h3 className="text-sm font-bold text-rose-600 uppercase tracking-wider mb-3">Danger Zone</h3>
                                    <Button variant="outline" onClick={() => { setSettingsOpen(false); setDeleteOpen(true); }}
                                        className="w-full border-rose-200 text-rose-600 hover:bg-rose-50 rounded-xl">
                                        <Trash className="w-4 h-4 mr-2" /> Delete Batch
                                    </Button>
                                </div>
                            )}
                        </div>
                        <div className="p-6 border-t bg-surface-2 flex gap-2 justify-end" style={{ borderColor: "var(--border-soft)" }}>
                            <SheetClose asChild>
                                <Button type="button" variant="outline" className="rounded-xl h-12 border-transparent shadow-sm bg-white">Cancel</Button>
                            </SheetClose>
                            <Button onClick={handleSaveSettings} disabled={saving || isSystemBatch} className="rounded-xl h-12 bg-primary text-white font-bold shadow-clay-inner">
                                {saving ? "Saving..." : "Save Changes"}
                            </Button>
                        </div>
                    </SheetContent>
                </Sheet>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="bg-white rounded-3xl border-0 shadow-clay-outer">
                    <CardHeader className="flex flex-row items-center justify-between p-6 pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500">Total Enrolled</CardTitle>
                        <Users className="h-5 w-5 text-indigo-500" />
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <div className="text-4xl font-serif font-bold text-slate-900">{batch.studentCount}</div>
                    </CardContent>
                </Card>
                <Card className="bg-white rounded-3xl border-0 shadow-clay-outer">
                    <CardHeader className="flex flex-row items-center justify-between p-6 pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500">Active Tests</CardTitle>
                        <FileText className="h-5 w-5 text-emerald-500" />
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <div className="text-4xl font-serif font-bold text-slate-900">{batch.assignmentCount}</div>
                    </CardContent>
                </Card>
                <Card className="bg-white rounded-3xl border-0 shadow-clay-outer">
                    <CardHeader className="flex flex-row items-center justify-between p-6 pb-2">
                        <CardTitle className="text-sm font-bold text-slate-500">Status</CardTitle>
                        <Settings className="h-5 w-5 text-amber-500" />
                    </CardHeader>
                    <CardContent className="p-6 pt-0">
                        <Badge variant="outline" className={`border-none font-bold uppercase tracking-wider text-xs px-3 py-1 ${statusBadge(batch.status)}`}>
                            {batch.status}
                        </Badge>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="users" className="w-full">
                <TabsList className="bg-surface-2 p-1 rounded-xl w-full justify-start h-auto flex-wrap mb-6" style={{ border: "var(--border-soft)" }}>
                    <TabsTrigger value="users" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary font-bold px-6 py-2.5">
                        Students ({batch.studentCount})
                    </TabsTrigger>
                    <TabsTrigger value="tests" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-primary font-bold px-6 py-2.5">
                        Tests & Assignments ({batch.assignmentCount})
                    </TabsTrigger>
                </TabsList>

                {/* Students Tab */}
                <TabsContent value="users" className="outline-none">
                    <Card className="bg-white border-0 rounded-3xl shadow-clay-outer overflow-hidden">
                        <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: "var(--border-soft)" }}>
                            <h2 className="text-xl font-serif font-bold text-slate-900">Enrolled Students</h2>
                            {isSystemBatch ? (
                                <p className="text-sm text-slate-500">Public free mocks use leads instead of enrolled students.</p>
                            ) : (
                                <Sheet open={addStudentOpen} onOpenChange={setAddStudentOpen}>
                                    <SheetTrigger asChild>
                                        <Button size="sm" className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold shadow-none border-none rounded-lg h-9">
                                            <Plus className="w-4 h-4 mr-2" /> Add Student
                                        </Button>
                                    </SheetTrigger>
                                    <SheetContent className="border-l-0 shadow-clay-outer p-0 sm:max-w-md w-full flex flex-col">
                                        <div className="p-6 border-b" style={{ borderColor: "var(--border-soft)" }}>
                                            <SheetHeader>
                                                <SheetTitle className="font-serif text-2xl text-slate-900">Add Students</SheetTitle>
                                                <SheetDescription>Select students to enroll in {batch.name}.</SheetDescription>
                                            </SheetHeader>
                                        </div>
                                        <div className="p-4 border-b" style={{ borderColor: "var(--border-soft)" }}>
                                            <div className="relative">
                                                <Search className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                                                <Input
                                                    placeholder="Search by name or email..."
                                                    value={studentSearch}
                                                    onChange={e => handleStudentSearch(e.target.value)}
                                                    className="pl-9 h-10 bg-surface-2 border-transparent rounded-xl"
                                                />
                                            </div>
                                            <p className="text-[11px] text-slate-400 mt-1.5 px-1">
                                                Showing {availableStudents.length} of {totalAvailable} students • Page {studentPage}
                                            </p>
                                        </div>
                                        <div className="flex-1 overflow-auto p-2">
                                            {loadingStudents && availableStudents.length === 0 ? (
                                                <div className="flex items-center justify-center py-12">
                                                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                                                </div>
                                            ) : availableStudents.length === 0 ? (
                                                <div className="text-center text-slate-400 py-12 text-sm">No available students found.</div>
                                            ) : (
                                                <>
                                                    {availableStudents.map(s => (
                                                        <button
                                                            key={s.id}
                                                            onClick={() => toggleStudent(s.id)}
                                                            className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors ${selectedStudents.has(s.id) ? "bg-emerald-50 border border-emerald-200" : "hover:bg-slate-50 border border-transparent"}`}
                                                        >
                                                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${selectedStudents.has(s.id) ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`}>
                                                                {selectedStudents.has(s.id) && <span className="text-white text-xs font-bold">✓</span>}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-bold text-slate-800 text-sm truncate">{s.name}</div>
                                                                <div className="text-xs text-slate-500 truncate">{s.email}</div>
                                                            </div>
                                                        </button>
                                                    ))}
                                                    {hasMoreStudents && (
                                                        <Button
                                                            variant="ghost"
                                                            onClick={loadMoreStudents}
                                                            disabled={loadingStudents}
                                                            className="w-full mt-2 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl"
                                                        >
                                                            {loadingStudents ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                                            Load More Students
                                                        </Button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                        <div className="p-4 border-t bg-surface-2 flex gap-2 justify-between items-center" style={{ borderColor: "var(--border-soft)" }}>
                                            <span className="text-sm text-slate-500 font-medium">{selectedStudents.size} selected</span>
                                            <Button onClick={handleEnrollStudents} disabled={enrolling || selectedStudents.size === 0}
                                                className="rounded-xl h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                                                {enrolling ? "Enrolling..." : `Enroll ${selectedStudents.size} Student(s)`}
                                            </Button>
                                        </div>
                                    </SheetContent>
                                </Sheet>
                            )}
                        </div>

                        {batch.students.length === 0 ? (
                            <div className="text-center font-medium text-slate-400 py-12 px-6">
                                {isSystemBatch
                                    ? "This protected system batch does not enroll users. Public free-mock participants are stored as leads."
                                    : 'No students enrolled yet. Click "Add Student" to enroll students.'}
                            </div>
                        ) : (
                            <Table>
                                <TableHeader className="bg-slate-50/80">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-semibold text-slate-700 pl-6 h-12">Name</TableHead>
                                        <TableHead className="font-semibold text-slate-700">Email</TableHead>
                                        <TableHead className="font-semibold text-slate-700">Status</TableHead>
                                        <TableHead className="text-right pr-6 font-semibold text-slate-700">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {batch.students.map(student => (
                                        <TableRow key={student.id} className="hover:bg-slate-50/50">
                                            <TableCell className="font-bold text-slate-900 pl-6">{student.name}</TableCell>
                                            <TableCell className="text-slate-600">{student.email}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={`border-none font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 ${student.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                                                    {student.status}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right pr-6">
                                                <Button variant="ghost" size="sm" onClick={() => handleUnenroll(student.id, student.name)}
                                                    disabled={isSystemBatch}
                                                    className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg h-8 px-2">
                                                    <X className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </Card>
                </TabsContent>

                {/* Tests & Assignments Tab */}
                <TabsContent value="tests" className="outline-none">
                    <Card className="bg-white border-0 rounded-3xl shadow-clay-outer overflow-hidden">
                        <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: "var(--border-soft)" }}>
                            <h2 className="text-xl font-serif font-bold text-slate-900">Batch Assessments</h2>
                        </div>
                        {batch.assignments.length === 0 ? (
                            <div className="text-center font-medium text-slate-400 py-12 px-6">
                                No tests assigned to this batch yet. Admins can assign tests from the Test Management page.
                            </div>
                        ) : (
                            <Table>
                                <TableHeader className="bg-slate-50/80">
                                    <TableRow className="hover:bg-transparent">
                                        <TableHead className="font-semibold text-slate-700 pl-6 h-12">Test Name</TableHead>
                                        <TableHead className="font-semibold text-slate-700">Duration</TableHead>
                                        <TableHead className="font-semibold text-slate-700">Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {batch.assignments.map(assignment => (
                                        <TableRow key={assignment.id} className="hover:bg-slate-50/50">
                                            <TableCell className="font-bold text-slate-900 pl-6">{assignment.test.title}</TableCell>
                                            <TableCell className="text-slate-600">{assignment.test.durationMinutes} min</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={`border-none font-bold text-[10px] uppercase tracking-wider px-2 py-0.5 ${statusBadge(assignment.test.status)}`}>
                                                    {assignment.test.status}
                                                </Badge>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Delete Dialog */}
            <DeleteConfirmDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                itemName={batch.name}
                itemType="batch"
                onDisable={handleDisableBatch}
                onPermanentDelete={handlePermanentDelete}
                disableLabel="Mark as Completed"
            />
        </div>
    );
}
