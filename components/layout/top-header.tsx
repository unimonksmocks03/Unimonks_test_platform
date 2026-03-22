"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Bell, ChevronDown, LogOut, User, Search, Moon, Sun } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import React from "react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "next-themes";
import { useState } from "react";

// Route group segments that shouldn't appear in breadcrumbs or generate links
const ROUTE_GROUP_SEGMENTS = new Set(["(auth)", "(public)"]);

// Known top-level route parents that don't have their own page
const NO_PAGE_SEGMENTS = new Set(["admin", "student"]);

export function TopHeader() {
    const pathname = usePathname();
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    // Filter out route group segments
    const segments = pathname
        .split("/")
        .filter((s) => s && !ROUTE_GROUP_SEGMENTS.has(s));

    const handleLogout = async () => {
        if (isLoggingOut) return;

        setIsLoggingOut(true);
        try {
            await logout();
            toast.info("Session Cleared", { description: "You have been successfully logged out." });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Logout failed. Please try again."
            toast.error("Logout Failed", { description: message });
        } finally {
            setIsLoggingOut(false);
        }
    };

    const toggleTheme = () => {
        setTheme(theme === "dark" ? "light" : "dark");
    };

    if (!user) return null;

    const initials = user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2);

    return (
        <header
            className="sticky top-0 z-10 bg-surface/50 backdrop-blur-md border-b h-16 w-full flex items-center justify-between px-6 shrink-0 shadow-sm"
            style={{ borderBottom: "var(--border-soft)" }}
        >
            <div className="flex items-center gap-4 flex-1">
                <SidebarTrigger
                    className="-ml-2 h-10 w-10 border border-slate-200 shadow-sm rounded-xl bg-white shrink-0"
                    aria-label="Toggle sidebar"
                />

                <div className="hidden lg:block shrink-0">
                    <Breadcrumb>
                        <BreadcrumbList>
                            {segments.map((segment, index) => {
                                const isLast = index === segments.length - 1;
                                const title = decodeURIComponent(segment).charAt(0).toUpperCase() + segment.slice(1);
                                const href = `/${segments.slice(0, index + 1).join("/")}`;
                                const isNoPage = NO_PAGE_SEGMENTS.has(segment);
                                return (
                                    <React.Fragment key={`${segment}-${index}`}>
                                        <BreadcrumbItem>
                                            {isLast ? (
                                                <BreadcrumbPage className="font-bold font-serif text-slate-800">
                                                    {title}
                                                </BreadcrumbPage>
                                            ) : isNoPage ? (
                                                <span className="font-medium text-slate-400">{title}</span>
                                            ) : (
                                                <BreadcrumbLink
                                                    href={href}
                                                    className="font-medium text-slate-500 hover:text-primary transition-colors cursor-pointer"
                                                >
                                                    {title}
                                                </BreadcrumbLink>
                                            )}
                                        </BreadcrumbItem>
                                        {!isLast && <BreadcrumbSeparator />}
                                    </React.Fragment>
                                );
                            })}
                        </BreadcrumbList>
                    </Breadcrumb>
                </div>

                <div className="hidden md:flex relative max-w-md w-full ml-4">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                        placeholder="Search students, batches, or tests... (Cmd+K)"
                        className="pl-9 h-10 rounded-xl bg-slate-100/50 border-transparent shadow-inner focus-visible:ring-primary font-medium w-full transition-all focus:bg-white focus:border-slate-200"
                        aria-label="Global search"
                    />
                </div>
            </div>

            <div className="flex items-center gap-3">
                <Button
                    variant="outline"
                    size="icon"
                    className="border-none bg-white shadow-sm rounded-full h-10 w-10"
                    onClick={toggleTheme}
                    aria-label="Toggle theme"
                >
                    {theme === "dark" ? (
                        <Sun className="h-4 w-4 text-amber-500" />
                    ) : (
                        <Moon className="h-4 w-4 text-slate-500" />
                    )}
                </Button>

                <Button
                    variant="outline"
                    size="icon"
                    className="text-slate-500 border-none bg-white shadow-sm rounded-full h-10 w-10"
                    aria-label="Notifications"
                >
                    <Bell className="h-4 w-4" />
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <div className="flex items-center gap-3 bg-white px-2 py-1.5 rounded-2xl shadow-sm border cursor-pointer border-slate-100 hover:border-slate-300 transition-colors">
                            <Avatar className="h-8 w-8 rounded-full border border-slate-200">
                                <AvatarImage src={user.avatarUrl} alt={`@${user.name}`} />
                                <AvatarFallback>{initials}</AvatarFallback>
                            </Avatar>
                            <div className="hidden sm:flex flex-col text-xs pr-2">
                                <span className="font-bold text-slate-800">{user.name}</span>
                                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true"></div>
                                    <span>Online</span>
                                </div>
                            </div>
                            <ChevronDown className="h-4 w-4 text-slate-400 mr-2" />
                        </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 rounded-xl border-slate-200 shadow-sm mt-2 font-medium">
                        <DropdownMenuLabel className="font-serif">My Account</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="cursor-pointer rounded-lg hover:bg-slate-50">
                            <User className="mr-2 h-4 w-4 text-slate-500" />
                            <span>Profile Options</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onClick={handleLogout}
                            disabled={isLoggingOut}
                            className="cursor-pointer rounded-lg text-rose-600 focus:text-rose-700 focus:bg-rose-50 flex items-center"
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            <span>{isLoggingOut ? "Logging out..." : "Log out"}</span>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
