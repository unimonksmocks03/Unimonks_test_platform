"use client";

import { useAuth, UserRole } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Route access rules per role.
 * Admin can access /admin/*.
 * Student can access /student/* and /arena/*.
 */
const ROLE_ALLOWED_PREFIXES: Record<UserRole, string[]> = {
    admin: ["/admin"],
    sub_admin: ["/admin"],
    student: ["/student", "/arena"],
};

const ROLE_HOME: Record<UserRole, string> = {
    admin: "/admin/dashboard",
    sub_admin: "/admin/dashboard",
    student: "/student/dashboard",
};

export function RouteGuard({ children }: { children: React.ReactNode }) {
    const { user, isLoading } = useAuth();
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        if (isLoading) return;

        // No user → go to login
        if (!user) {
            router.replace("/login");
            return;
        }

        // Check if the current path is allowed for this role
        const allowed = ROLE_ALLOWED_PREFIXES[user.role];
        const isAllowed = allowed.some((prefix) => pathname.startsWith(prefix));

        if (!isAllowed) {
            router.replace(ROLE_HOME[user.role]);
        }
    }, [user, isLoading, pathname, router]);

    // Show nothing while loading or redirecting unauthorized
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen w-full">
                <div className="animate-pulse text-slate-400 font-medium">Loading...</div>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    // Check authorization inline too (before redirect completes)
    const allowed = ROLE_ALLOWED_PREFIXES[user.role];
    const isAllowed = allowed.some((prefix) => pathname.startsWith(prefix));
    if (!isAllowed) {
        return null;
    }

    return <>{children}</>;
}
