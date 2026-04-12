"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Edit, Trash2 } from "lucide-react";
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
    SheetTrigger, SheetFooter, SheetClose
} from "@/components/ui/sheet";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useAuth } from "@/lib/auth-context";
import { PaginationNav } from "@/components/ui/pagination-nav";

type User = {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
    batches: BatchOption[];
};

type BatchOption = {
    id: string;
    name: string;
    code: string;
    status: string;
    kind: "FREE_SYSTEM" | "STANDARD";
};

type UsersResponse = {
    users: User[];
    total: number;
    page: number;
    totalPages: number;
};

type CreateUserPayload = {
    name: string;
    email: string;
    role: "STUDENT" | "SUB_ADMIN";
};

type UpdateUserPayload = {
    name: string;
    email: string;
    role: "ADMIN" | "SUB_ADMIN" | "STUDENT";
    status: "ACTIVE" | "INACTIVE" | "SUSPENDED";
    batchIds?: string[];
};

type BatchesResponse = {
    batches: BatchOption[];
    total: number;
    page: number;
    totalPages: number;
};

function formatRoleLabel(role: string) {
    if (role === "ADMIN") return "Admin";
    if (role === "SUB_ADMIN") return "Sub-admin";
    return "Student";
}

const PAGE_SIZE = 20;

export default function UserManagementPage() {
    const { user: currentUser } = useAuth();
    const isPrimaryAdmin = currentUser?.role === "admin";
    const [isLoading, setIsLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [availableBatches, setAvailableBatches] = useState<BatchOption[]>([]);
    const [isBatchOptionsLoading, setIsBatchOptionsLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [searchQuery, setSearchQuery] = useState("");
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createRole, setCreateRole] = useState<"STUDENT" | "SUB_ADMIN">("STUDENT");
    const [subAdminConfirmOpen, setSubAdminConfirmOpen] = useState(false);
    const [, setPendingRoleSelection] = useState<"SUB_ADMIN" | null>(null);

    const fetchUsers = useCallback(async (filters?: {
        search?: string;
        role?: string;
        status?: string;
        page?: number;
    }) => {
        setIsLoading(true);
        const params: Record<string, string | number | undefined> = {};
        if (filters?.search) params.search = filters.search;
        if (filters?.role && filters.role !== "all") params.role = filters.role.toUpperCase();
        if (filters?.status && filters.status !== "all") params.status = filters.status.toUpperCase();
        params.page = filters?.page || 1;
        params.limit = PAGE_SIZE;

        const res = await apiClient.get<UsersResponse>("/api/admin/users", params);
        if (res.ok) {
            const nextTotalPages = Math.max(1, res.data.totalPages);
            if (filters?.page && filters.page > nextTotalPages) {
                setTotalPages(nextTotalPages);
                setPage(nextTotalPages);
                setIsLoading(false);
                return;
            }
            setUsers(res.data.users);
            setTotal(res.data.total);
            setTotalPages(nextTotalPages);
        } else {
            toast.error("Failed to load users", { description: res.message });
        }
        setIsLoading(false);
    }, []);

    const fetchAvailableBatches = useCallback(async () => {
        setIsBatchOptionsLoading(true);
        const collected: BatchOption[] = [];
        let nextPage = 1;
        let totalPages = 1;

        do {
            const res = await apiClient.get<BatchesResponse>("/api/admin/batches", {
                page: nextPage,
                limit: 100,
            });

            if (!res.ok) {
                toast.error("Failed to load batch options", { description: res.message });
                setIsBatchOptionsLoading(false);
                return;
            }

            collected.push(...res.data.batches.filter((batch) => batch.kind === "STANDARD"));
            totalPages = res.data.totalPages;
            nextPage += 1;
        } while (nextPage <= totalPages);

        setAvailableBatches(
            collected.sort((left, right) => left.name.localeCompare(right.name))
        );
        setIsBatchOptionsLoading(false);
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch paginated server data when filters or page change
        void fetchUsers({
            search: deferredSearchQuery.trim() || undefined,
            role: roleFilter,
            status: statusFilter,
            page,
        });
    }, [deferredSearchQuery, roleFilter, statusFilter, page, fetchUsers]);

    useEffect(() => {
        void fetchAvailableBatches();
    }, [fetchAvailableBatches]);

    const submitCreateUser = async (payload: CreateUserPayload) => {
        setCreating(true);
        const res = await apiClient.post("/api/admin/users", payload);
        if (res.ok) {
            toast.success("User Created", {
                description: `${payload.name} has been added as ${formatRoleLabel(payload.role).toLowerCase()}.`,
            });
            setCreateDialogOpen(false);
            setCreateRole("STUDENT");
            setPage(1);
            void fetchUsers({
                search: deferredSearchQuery.trim() || undefined,
                role: roleFilter,
                status: statusFilter,
                page: 1,
            });
        } else {
            toast.error("Failed to create user", { description: res.message });
        }
        setCreating(false);
    };

    const handleCreateUser = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const payload: CreateUserPayload = {
            name: (formData.get("name") as string).trim(),
            email: (formData.get("email") as string).trim(),
            role: createRole,
        };

        await submitCreateUser(payload);
    };

    const handleSaveUser = async (userId: string, body: UpdateUserPayload) => {
        const res = await apiClient.patch(`/api/admin/users/${userId}`, body);
        if (res.ok) {
            toast.success("User Updated");
            void fetchUsers({
                search: deferredSearchQuery.trim() || undefined,
                role: roleFilter,
                status: statusFilter,
                page,
            });
        } else {
            toast.error("Failed to update user", { description: res.message });
        }
    };

    const handleDeleteUser = (userId: string, userName: string) => {
        setDeleteTarget({ id: userId, name: userName });
    };

    const handlePermanentDeactivate = async () => {
        if (!deleteTarget) return;
        const res = await apiClient.delete(`/api/admin/users/${deleteTarget.id}`);
        if (res.ok) {
            toast.success("User Deactivated", { description: `${deleteTarget.name} has been deactivated.` });
            void fetchUsers({
                search: deferredSearchQuery.trim() || undefined,
                role: roleFilter,
                status: statusFilter,
                page,
            });
            setDeleteTarget(null);
        } else {
            toast.error("Failed to deactivate user", { description: res.message });
        }
    };

    const statusBadgeStyle = (status: string) => {
        const s = status.toLowerCase();
        if (s === "active") return "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-none px-3 font-bold uppercase tracking-wider text-[10px]";
        if (s === "inactive") return "bg-slate-100 text-slate-500 hover:bg-slate-200 border-none px-3 font-bold uppercase tracking-wider text-[10px]";
        return "bg-amber-50 text-amber-700 hover:bg-amber-100 border-none px-3 font-bold uppercase tracking-wider text-[10px]";
    };

    return (
        <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto pb-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b pb-6 gap-4" style={{ borderColor: 'var(--border-soft)' }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight">User Management</h1>
                    <p className="text-slate-500 mt-1">Manage the protected owner admin, temporary sub-admins, and enrolled student access.</p>
                </div>

                <Dialog
                    open={createDialogOpen}
                    onOpenChange={(open) => {
                        setCreateDialogOpen(open);
                        if (!open) {
                            setCreateRole("STUDENT");
                            setSubAdminConfirmOpen(false);
                            setPendingRoleSelection(null);
                        }
                    }}
                >
                    <DialogTrigger asChild>
                        <Button className="bg-primary hover:bg-primary/90 rounded-xl px-6 h-12 shadow-clay-inner text-white font-bold text-base">
                            <Plus className="h-5 w-5 mr-2" />
                            Add User
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[425px] rounded-3xl p-6 border-0 shadow-clay-outer">
                        <DialogHeader>
                            <DialogTitle className="font-serif text-2xl">Create User</DialogTitle>
                            <DialogDescription>
                                Add an enrolled student or grant temporary sub-admin access. The owner admin account remains fixed.
                            </DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleCreateUser}>
                            <div className="grid gap-6 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="name" className="font-bold text-slate-700">Full Name</Label>
                                    <Input id="name" name="name" placeholder="Alice Smith" required className="rounded-xl h-11 bg-surface-2 border-transparent" />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="email" className="font-bold text-slate-700">Email Address</Label>
                                    <Input id="email" name="email" type="email" placeholder="alice@example.com" required className="rounded-xl h-11 bg-surface-2 border-transparent" />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="font-bold text-slate-700">Role</Label>
                                    <Select
                                        value={createRole}
                                        onValueChange={(value) => {
                                            if (value === "SUB_ADMIN") {
                                                setPendingRoleSelection("SUB_ADMIN");
                                                setSubAdminConfirmOpen(true);
                                                return;
                                            }

                                            setPendingRoleSelection(null);
                                            setCreateRole("STUDENT");
                                        }}
                                    >
                                        <SelectTrigger className="rounded-xl h-11 bg-surface-2 border-transparent font-medium">
                                            <SelectValue placeholder="Select role" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl">
                                            <SelectItem value="STUDENT">Student</SelectItem>
                                            {isPrimaryAdmin ? (
                                                <SelectItem value="SUB_ADMIN">Sub-admin</SelectItem>
                                            ) : null}
                                        </SelectContent>
                                    </Select>
                                    {isPrimaryAdmin ? (
                                        <p className="text-xs text-slate-500">
                                            Sub-admins get full admin-panel access, but only the owner admin can suspend, deactivate, or delete them.
                                        </p>
                                    ) : (
                                        <p className="text-xs text-slate-500">
                                            Only the owner admin can grant sub-admin access. You can add student accounts from here.
                                        </p>
                                    )}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="submit" disabled={creating} className="w-full bg-primary hover:bg-primary/90 rounded-xl h-12 text-base font-bold shadow-clay-inner">
                                    {creating ? "Creating..." : createRole === "SUB_ADMIN" ? "Create Sub-admin" : "Create User"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Toolbar */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded-2xl border-0 shadow-sm" style={{ boxShadow: 'var(--shadow-clay-outer)' }}>
                <div className="flex flex-1 flex-col sm:flex-row items-center gap-3 w-full">
                    <div className="relative w-full md:max-w-md">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => {
                                setSearchQuery(e.target.value);
                                setPage(1);
                            }}
                            className="pl-10 rounded-xl h-11 bg-surface-2 border-transparent font-medium"
                            placeholder="Search users by name or email..."
                        />
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto">
                        <Select
                            value={roleFilter}
                            onValueChange={(value) => {
                                setRoleFilter(value);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="w-full sm:w-[140px] rounded-xl h-11 bg-surface-2 border-transparent font-medium">
                                <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="all">All Roles</SelectItem>
                                <SelectItem value="sub_admin">Sub-admin</SelectItem>
                                <SelectItem value="student">Student</SelectItem>
                                <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                        </Select>
                        <Select
                            value={statusFilter}
                            onValueChange={(value) => {
                                setStatusFilter(value);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="w-full sm:w-[140px] rounded-xl h-11 bg-surface-2 border-transparent font-medium">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent className="rounded-xl">
                                <SelectItem value="all">All Statuses</SelectItem>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                                <SelectItem value="suspended">Suspended</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* Data Table */}
            <div className="bg-white rounded-3xl border-0 shadow-sm overflow-hidden text-sm" style={{ boxShadow: 'var(--shadow-clay-outer)' }}>
                <Table>
                    <TableHeader className="bg-surface border-b" style={{ borderColor: 'var(--border-soft)' }}>
                        <TableRow className="hover:bg-transparent border-0">
                            <TableHead className="w-[50px] pl-6 py-4"><Checkbox className="border-slate-300 rounded-[4px]" /></TableHead>
                            <TableHead className="font-bold text-slate-800 font-serif text-sm">Name</TableHead>
                            <TableHead className="font-bold text-slate-800 font-serif text-sm">Email</TableHead>
                            <TableHead className="font-bold text-slate-800 font-serif text-sm">Role</TableHead>
                            <TableHead className="font-bold text-slate-800 font-serif text-sm">Status</TableHead>
                            <TableHead className="text-right pr-8 font-bold text-slate-800 font-serif text-sm">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody className="divide-y divide-slate-100">
                        {isLoading ? (
                            [1, 2, 3, 4, 5].map((i) => (
                                <TableRow key={`skeleton-${i}`} className="border-0">
                                    <TableCell className="pl-6 py-4"><Skeleton className="h-4 w-4" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                                    <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                                    <TableCell className="text-right pr-8"><Skeleton className="h-8 w-8 rounded-xl ml-auto" /></TableCell>
                                </TableRow>
                            ))
                        ) : users.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-slate-400">
                                    No users found. Try adjusting your filters.
                                </TableCell>
                            </TableRow>
                        ) : (
                            users.map((user) => {
                                const isOwnerAdminRow = user.role === "ADMIN";
                                const isSubAdminRow = user.role === "SUB_ADMIN";
                                const isOwnerAdminProtected = isOwnerAdminRow && !isPrimaryAdmin;
                                const isSubAdminProtected = isSubAdminRow && !isPrimaryAdmin;
                                const canDeleteUser =
                                    user.status !== "INACTIVE" &&
                                    !isOwnerAdminRow &&
                                    (!isSubAdminRow || isPrimaryAdmin);

                                return (
                                    <TableRow key={user.id} className="group border-0 hover:bg-surface/30 transition-colors">
                                        <TableCell className="pl-6 py-4">
                                            <Checkbox className="border-slate-300 rounded-[4px] data-[state=checked]:bg-primary" />
                                        </TableCell>
                                        <TableCell className="font-bold text-slate-900 group-hover:text-primary transition-colors">
                                            {user.name}
                                        </TableCell>
                                        <TableCell className="text-slate-500 font-medium">{user.email}</TableCell>
                                        <TableCell className="text-slate-700 font-medium">{formatRoleLabel(user.role)}</TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className={statusBadgeStyle(user.status)}>
                                                {user.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right pr-8">
                                            <div className="flex items-center justify-end gap-1">
                                                <EditUserSheet
                                                    user={user}
                                                    isPrimaryAdmin={isPrimaryAdmin}
                                                    availableBatches={availableBatches}
                                                    isBatchOptionsLoading={isBatchOptionsLoading}
                                                    onSave={handleSaveUser}
                                                />
                                                {canDeleteUser && (
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-9 w-9 shadow-none text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl"
                                                        onClick={() => handleDeleteUser(user.id, user.name)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            <div className="mt-4">
                <PaginationNav
                    page={page}
                    pageSize={PAGE_SIZE}
                    totalItems={total}
                    totalPages={totalPages}
                    itemLabel="users"
                    isLoading={isLoading}
                    onPageChange={setPage}
                />
            </div>

            <DeleteConfirmDialog
                open={!!deleteTarget}
                onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
                itemName={deleteTarget?.name || ""}
                itemType="user"
                showDisableOption={false}
                onPermanentDelete={handlePermanentDeactivate}
            />

            <AlertDialog
                open={subAdminConfirmOpen}
                onOpenChange={(open) => {
                    setSubAdminConfirmOpen(open);
                    if (!open) {
                        setPendingRoleSelection(null);
                    }
                }}
            >
                <AlertDialogContent className="rounded-2xl border-0 shadow-lg max-w-md">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-serif text-xl text-slate-900">
                            Grant sub-admin access?
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-500 leading-relaxed">
                            This user will get full access to the admin panel. Only the owner admin can suspend, deactivate,
                            or delete a sub-admin later.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel
                            className="rounded-xl border-slate-200"
                            onClick={() => setPendingRoleSelection(null)}
                        >
                            Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                            className="rounded-xl bg-primary text-white hover:bg-primary/90"
                            onClick={() => {
                                setCreateRole("SUB_ADMIN");
                                setPendingRoleSelection(null);
                                setSubAdminConfirmOpen(false);
                            }}
                        >
                            Yes, make this a sub-admin
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

type EditUserSheetProps = {
    user: User;
    isPrimaryAdmin: boolean;
    availableBatches: BatchOption[];
    isBatchOptionsLoading: boolean;
    onSave: (userId: string, payload: UpdateUserPayload) => Promise<void>;
};

function EditUserSheet({
    user,
    isPrimaryAdmin,
    availableBatches,
    isBatchOptionsLoading,
    onSave,
}: EditUserSheetProps) {
    const [open, setOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [name, setName] = useState(user.name);
    const [email, setEmail] = useState(user.email);
    const [role, setRole] = useState<"ADMIN" | "SUB_ADMIN" | "STUDENT">(user.role as "ADMIN" | "SUB_ADMIN" | "STUDENT");
    const [status, setStatus] = useState<"ACTIVE" | "INACTIVE" | "SUSPENDED">(user.status as "ACTIVE" | "INACTIVE" | "SUSPENDED");
    const [batchSearch, setBatchSearch] = useState("");
    const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>(user.batches.map((batch) => batch.id));

    useEffect(() => {
        if (!open) {
            setName(user.name);
            setEmail(user.email);
            setRole(user.role as "ADMIN" | "SUB_ADMIN" | "STUDENT");
            setStatus(user.status as "ACTIVE" | "INACTIVE" | "SUSPENDED");
            setSelectedBatchIds(user.batches.map((batch) => batch.id));
            setBatchSearch("");
        }
    }, [open, user]);

    const isOwnerAdminRow = user.role === "ADMIN";
    const isSubAdminRow = user.role === "SUB_ADMIN";
    const isOwnerAdminProtected = isOwnerAdminRow && !isPrimaryAdmin;
    const isSubAdminProtected = isSubAdminRow && !isPrimaryAdmin;
    const batchesVisible = role === "STUDENT";

    const filteredBatches = useMemo(() => {
        const query = batchSearch.trim().toLowerCase();
        if (!query) {
            return availableBatches;
        }

        return availableBatches.filter((batch) =>
            batch.name.toLowerCase().includes(query) || batch.code.toLowerCase().includes(query)
        );
    }, [availableBatches, batchSearch]);

    const toggleBatch = (batchId: string) => {
        setSelectedBatchIds((current) =>
            current.includes(batchId)
                ? current.filter((id) => id !== batchId)
                : [...current, batchId]
        );
    };

    const handleSave = async () => {
        setIsSaving(true);
        await onSave(user.id, {
            name: name.trim(),
            email: email.trim(),
            role,
            status,
            batchIds: batchesVisible ? selectedBatchIds : [],
        });
        setIsSaving(false);
        setOpen(false);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 shadow-none text-slate-400 hover:text-primary hover:bg-surface-2 rounded-xl">
                    <Edit className="h-4 w-4" />
                </Button>
            </SheetTrigger>
            <SheetContent className="border-l-0 shadow-clay-outer p-0 sm:max-w-md w-full flex flex-col">
                <div className="p-6 border-b" style={{ borderColor: 'var(--border-soft)' }}>
                    <SheetHeader>
                        <SheetTitle className="font-serif text-2xl text-slate-900">Edit User</SheetTitle>
                        <SheetDescription>
                            Make changes to {user.name}&apos;s profile and study-batch access here.
                        </SheetDescription>
                    </SheetHeader>
                </div>
                <div className="p-6 flex-1 overflow-auto grid gap-6 content-start">
                    <div className="grid gap-2">
                        <Label className="font-bold text-slate-700">Full Name</Label>
                        <Input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            disabled={isOwnerAdminProtected || isSubAdminProtected}
                            className="rounded-xl h-11 bg-surface-2 border-transparent disabled:bg-slate-100 disabled:text-slate-600"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label className="font-bold text-slate-700">Email Address</Label>
                        <Input
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            disabled={isOwnerAdminProtected || isSubAdminProtected}
                            className="rounded-xl h-11 bg-surface-2 border-transparent disabled:bg-slate-100 disabled:text-slate-600"
                        />
                    </div>
                    <div className="grid gap-2">
                        <Label className="font-bold text-slate-700">Role</Label>
                        {isOwnerAdminRow ? (
                            <Input
                                value="Admin (Owner)"
                                disabled
                                className="rounded-xl h-11 bg-slate-100 border-transparent text-slate-600"
                            />
                        ) : isPrimaryAdmin ? (
                            <Select
                                value={role}
                                onValueChange={(value) => setRole(value as "SUB_ADMIN" | "STUDENT")}
                            >
                                <SelectTrigger className="rounded-xl h-11 bg-surface-2 border-transparent">
                                    <SelectValue placeholder="Select role" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    <SelectItem value="STUDENT">Student</SelectItem>
                                    <SelectItem value="SUB_ADMIN">Sub-admin</SelectItem>
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input
                                value={formatRoleLabel(user.role)}
                                disabled
                                className="rounded-xl h-11 bg-slate-100 border-transparent text-slate-600"
                            />
                        )}
                    </div>
                    <div className="grid gap-2">
                        <Label className="font-bold text-slate-700">Status</Label>
                        {isOwnerAdminRow || isSubAdminProtected ? (
                            <Input
                                value={status}
                                disabled
                                className="rounded-xl h-11 bg-slate-100 border-transparent text-slate-600"
                            />
                        ) : (
                            <Select value={status} onValueChange={(value) => setStatus(value as "ACTIVE" | "INACTIVE" | "SUSPENDED")}>
                                <SelectTrigger className="rounded-xl h-11 bg-surface-2 border-transparent">
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl">
                                    <SelectItem value="ACTIVE">Active</SelectItem>
                                    <SelectItem value="INACTIVE">Inactive</SelectItem>
                                    <SelectItem value="SUSPENDED">Suspended</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    {batchesVisible ? (
                        <div className="grid gap-3">
                            <div className="flex items-center justify-between gap-3">
                                <Label className="font-bold text-slate-700">Assigned Batches</Label>
                                <span className="text-xs font-medium text-slate-500">
                                    {selectedBatchIds.length} selected
                                </span>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                <Input
                                    value={batchSearch}
                                    onChange={(event) => setBatchSearch(event.target.value)}
                                    placeholder="Search batches by name or code..."
                                    className="pl-9 rounded-xl h-11 bg-surface-2 border-transparent"
                                />
                            </div>
                            <div className="max-h-64 overflow-y-auto rounded-2xl border bg-surface-2/60 p-2" style={{ borderColor: 'var(--border-soft)' }}>
                                {isBatchOptionsLoading ? (
                                    <div className="space-y-2 p-2">
                                        {[1, 2, 3].map((index) => (
                                            <Skeleton key={`batch-option-skeleton-${index}`} className="h-10 rounded-xl" />
                                        ))}
                                    </div>
                                ) : filteredBatches.length === 0 ? (
                                    <p className="px-3 py-6 text-center text-sm text-slate-500">
                                        No batches match this search.
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {filteredBatches.map((batch) => {
                                            const checked = selectedBatchIds.includes(batch.id);
                                            return (
                                                <label
                                                    key={batch.id}
                                                    className="flex cursor-pointer items-start gap-3 rounded-xl bg-white px-3 py-3 shadow-sm transition hover:bg-slate-50"
                                                >
                                                    <Checkbox
                                                        checked={checked}
                                                        onCheckedChange={() => toggleBatch(batch.id)}
                                                        className="mt-0.5 border-slate-300 rounded-[4px] data-[state=checked]:bg-primary"
                                                    />
                                                    <div className="flex-1">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="font-medium text-slate-900">{batch.name}</span>
                                                            <Badge variant="outline" className="rounded-full border-none bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                                                                {batch.code}
                                                            </Badge>
                                                        </div>
                                                        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                                                            {batch.status}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">
                                This updates the same batch-enrollment records used by Batch Management.
                            </p>
                        </div>
                    ) : user.batches.length > 0 ? (
                        <p className="text-xs text-slate-500">
                            Saving this user as {formatRoleLabel(role).toLowerCase()} will remove their current student-batch assignments.
                        </p>
                    ) : null}
                    {isOwnerAdminProtected ? (
                        <p className="text-xs text-slate-500">
                            Only the owner admin can change the main admin account details.
                        </p>
                    ) : isOwnerAdminRow ? (
                        <p className="text-xs text-slate-500">
                            The owner admin account is protected from role, status, and deletion changes.
                        </p>
                    ) : isSubAdminProtected ? (
                        <p className="text-xs text-slate-500">
                            Only the owner admin can change or revoke a sub-admin account.
                        </p>
                    ) : isSubAdminRow ? (
                        <p className="text-xs text-slate-500">
                            This user currently has full admin-panel access. The owner admin can downgrade or deactivate it here.
                        </p>
                    ) : null}
                </div>
                <div className="p-6 border-t bg-surface-2" style={{ borderColor: 'var(--border-soft)' }}>
                    <SheetFooter className="flex-col sm:flex-row gap-2">
                        <SheetClose asChild>
                            <Button variant="outline" className="rounded-xl h-12 w-full sm:w-auto border-transparent shadow-sm bg-white">Cancel</Button>
                        </SheetClose>
                        <Button
                            type="button"
                            disabled={isOwnerAdminProtected || isSubAdminProtected || isSaving}
                            onClick={handleSave}
                            className="rounded-xl h-12 w-full sm:w-auto bg-primary text-white font-bold shadow-clay-inner"
                        >
                            {isSaving ? "Saving..." : "Save Changes"}
                        </Button>
                    </SheetFooter>
                </div>
            </SheetContent>
        </Sheet>
    );
}
