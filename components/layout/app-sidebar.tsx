"use client";

import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarFooter,
} from "@/components/ui/sidebar";
import { UnimonksBrand } from "@/components/branding/unimonks-brand";
import { Users, LayoutDashboard, FileText, FolderOpen, BarChart3 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, UserRole } from "@/lib/auth-context";

interface NavItem {
    title: string;
    url: string;
    icon: React.ComponentType<{ className?: string }>;
    roles: UserRole[];
}

const items: NavItem[] = [
    // Admin
    {
        title: "Dashboard",
        url: "/admin/dashboard",
        icon: LayoutDashboard,
        roles: ["admin", "sub_admin"],
    },
    {
        title: "User Management",
        url: "/admin/users",
        icon: Users,
        roles: ["admin", "sub_admin"],
    },
    {
        title: "Batch Management",
        url: "/admin/batches",
        icon: FolderOpen,
        roles: ["admin", "sub_admin"],
    },
    {
        title: "Test Management",
        url: "/admin/tests",
        icon: FileText,
        roles: ["admin", "sub_admin"],
    },
    // Student
    {
        title: "Dashboard",
        url: "/student/dashboard",
        icon: LayoutDashboard,
        roles: ["student"],
    },
    {
        title: "My Results",
        url: "/student/results",
        icon: BarChart3,
        roles: ["student"],
    },
];

const roleLabels: Record<UserRole, string> = {
    admin: "Administration",
    sub_admin: "Administration",
    student: "Learning",
};

function formatRoleLabel(role: UserRole) {
    if (role === "sub_admin") return "Sub-admin";
    return role.charAt(0).toUpperCase() + role.slice(1);
}

export function AppSidebar() {
    const pathname = usePathname();
    const { user } = useAuth();

    if (!user) return null;

    const filteredItems = items.filter((item) => item.roles.includes(user.role));

    return (
        <Sidebar variant="inset">
            <SidebarHeader className="p-4 border-b h-16 flex items-center justify-center">
                <Link href="/" className="flex items-center justify-center">
                    <UnimonksBrand
                        className="gap-2"
                        imageClassName="h-10 w-auto"
                        titleClassName="text-[1.1rem]"
                        cuetClassName="text-[1.1rem]"
                        underlineClassName="mt-1 h-[3px] w-[92%]"
                    />
                </Link>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>{roleLabels[user.role]}</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {filteredItems.map((item) => {
                                const isActive = pathname?.startsWith(item.url);
                                return (
                                    <SidebarMenuItem key={item.title + item.url}>
                                        <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
                                            <Link href={item.url}>
                                                <item.icon />
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                );
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter className="p-4 border-t text-xs text-slate-400 text-center">
                <span>Logged in as <span className="font-bold text-slate-600">{formatRoleLabel(user.role)}</span></span>
            </SidebarFooter>
        </Sidebar>
    );
}
