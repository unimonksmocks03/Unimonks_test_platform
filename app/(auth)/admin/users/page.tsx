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
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { DeleteConfirmDialog } from "@/components/ui/delete-confirm-dialog";
import { useAuth } from "@/lib/auth-context";

type User = {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
};

type UsersResponse = {
    users: User[];
    total: number;
    totalPages: number;
};

type CreateUserPayload = {
    name: string;
    email: string;
    role: "STUDENT" | "SUB_ADMIN";
};

function formatRoleLabel(role: string) {
    if (role === "ADMIN") return "Admin";
    if (role === "SUB_ADMIN") return "Sub-admin";
    return "Student";
}

function normalizeSelectValue(value: string) {
    return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export default function UserManagementPage() {
    const { user: currentUser } = useAuth();
    const isPrimaryAdmin = currentUser?.role === "admin";
    const [isLoading, setIsLoading] = useState(true);
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [total, setTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [roleFilter, setRoleFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createRole, setCreateRole] = useState<"STUDENT" | "SUB_ADMIN">("STUDENT");
    const [subAdminConfirmOpen, setSubAdminConfirmOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
    const [pendingRoleSelection, setPendingRoleSelection] = useState<"SUB_ADMIN" | null>(null);

    const fetchUsers = useCallback(async (search?: string, role?: string, status?: string) => {
        setIsLoading(true);
        const params: Record<string, string | number | undefined> = {};
        if (search) params.search = search;
        if (role && role !== "all") params.role = role.toUpperCase();
        if (status && status !== "all") params.status = status.toUpperCase();

        const res = await apiClient.get<UsersResponse>("/api/admin/users", params);
        if (res.ok) {
            setUsers(res.data.users);
            setTotal(res.data.total);
        } else {
            toast.error("Failed to load users", { description: res.message });
        }
        setIsLoading(false);
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial data fetch
        fetchUsers();
    }, [fetchUsers]);

    // Debounced search
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchUsers(searchQuery, roleFilter, statusFilter);
        }, 400);
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, [searchQuery, roleFilter, statusFilter, fetchUsers]);

    const submitCreateUser = async (payload: CreateUserPayload) => {
        setCreating(true);
        const res = await apiClient.post("/api/admin/users", payload);
        if (res.ok) {
            toast.success("User Created", {
                description: `${payload.name} has been added as ${formatRoleLabel(payload.role).toLowerCase()}.`,
            });
            setCreateDialogOpen(false);
            setCreateRole("STUDENT");
            fetchUsers(searchQuery, roleFilter, statusFilter);
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

    const handleSaveUser = async (userId: string, formEl: HTMLDivElement) => {
        const nameInput = formEl.querySelector<HTMLInputElement>(`[data-field="name"]`);
        const emailInput = formEl.querySelector<HTMLInputElement>(`[data-field="email"]`);

        const body: Record<string, string> = {};
        if (nameInput?.value) body.name = nameInput.value;
        if (emailInput?.value) body.email = emailInput.value;

        const roleSelect = formEl.querySelector<HTMLButtonElement>(`[data-field="role"]`);
        const statusSelect = formEl.querySelector<HTMLButtonElement>(`[data-field="status"]`);
        if (roleSelect?.textContent) body.role = normalizeSelectValue(roleSelect.textContent);
        if (statusSelect?.textContent) body.status = normalizeSelectValue(statusSelect.textContent);

        const res = await apiClient.patch(`/api/admin/users/${userId}`, body);
        if (res.ok) {
            toast.success("User Updated");
            fetchUsers(searchQuery, roleFilter, statusFilter);
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
            fetchUsers(searchQuery, roleFilter, statusFilter);
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
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 rounded-xl h-11 bg-surface-2 border-transparent font-medium"
                            placeholder="Search users by name or email..."
                        />
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto">
                        <Select value={roleFilter} onValueChange={setRoleFilter}>
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
                        <Select value={statusFilter} onValueChange={setStatusFilter}>
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
                                                <Sheet>
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
                                                                    Make changes to {user.name}&apos;s profile here.
                                                                </SheetDescription>
                                                            </SheetHeader>
                                                        </div>
                                                        <div className="p-6 flex-1 overflow-auto grid gap-6 content-start" id={`edit-form-${user.id}`}>
                                                            <div className="grid gap-2">
                                                                <Label className="font-bold text-slate-700">Full Name</Label>
                                                                <Input
                                                                    data-field="name"
                                                                    defaultValue={user.name}
                                                                    disabled={isOwnerAdminProtected || isSubAdminProtected}
                                                                    className="rounded-xl h-11 bg-surface-2 border-transparent disabled:bg-slate-100 disabled:text-slate-600"
                                                                />
                                                            </div>
                                                            <div className="grid gap-2">
                                                                <Label className="font-bold text-slate-700">Email Address</Label>
                                                                <Input
                                                                    data-field="email"
                                                                    defaultValue={user.email}
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
                                                                    <Select defaultValue={user.role}>
                                                                        <SelectTrigger data-field="role" className="rounded-xl h-11 bg-surface-2 border-transparent">
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
                                                                        value={user.status}
                                                                        disabled
                                                                        className="rounded-xl h-11 bg-slate-100 border-transparent text-slate-600"
                                                                    />
                                                                ) : (
                                                                    <Select defaultValue={user.status}>
                                                                        <SelectTrigger data-field="status" className="rounded-xl h-11 bg-surface-2 border-transparent">
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
                                                                    disabled={isOwnerAdminProtected || isSubAdminProtected}
                                                                    onClick={() => {
                                                                        const formEl = document.getElementById(`edit-form-${user.id}`);
                                                                        if (formEl) handleSaveUser(user.id, formEl as HTMLDivElement);
                                                                    }}
                                                                    className="rounded-xl h-12 w-full sm:w-auto bg-primary text-white font-bold shadow-clay-inner"
                                                                >
                                                                    Save Changes
                                                                </Button>
                                                            </SheetFooter>
                                                        </div>
                                                    </SheetContent>
                                                </Sheet>
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

            <div className="text-center text-xs text-slate-500 font-medium mt-2">
                Showing {users.length} of {total} total users
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
