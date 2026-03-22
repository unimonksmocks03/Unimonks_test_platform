"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useRouter } from "next/navigation";

export type UserRole = "admin" | "sub_admin" | "student";

interface User {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    avatarUrl?: string;
}

interface ImpersonationState {
    isActive: boolean;
    originalUser?: User;
    impersonatedUser?: User;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    impersonation: ImpersonationState;
    setImpersonation: (state: ImpersonationState) => void;
    setUser: (user: User | null) => void;
    logout: () => Promise<void>;
}

const STORAGE_KEY = "unimonk_user";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUserState] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [impersonation, setImpersonation] = useState<ImpersonationState>({
        isActive: false,
    });
    const router = useRouter();

    useEffect(() => {
        let isMounted = true;

        const bootstrapSession = async () => {
            try {
                const response = await fetch("/api/auth/session", {
                    method: "GET",
                    cache: "no-store",
                    credentials: "same-origin",
                });

                if (!isMounted) return;

                if (!response.ok) {
                    setUserState(null);
                    localStorage.removeItem(STORAGE_KEY);
                    return;
                }

                const data = await response.json();
                setUserState(data.user ?? null);
            } catch {
                if (isMounted) {
                    setUserState(null);
                    localStorage.removeItem(STORAGE_KEY);
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        void bootstrapSession();

        return () => {
            isMounted = false;
        };
    }, []);

    const setUser = (newUser: User | null) => {
        setUserState(newUser);
        if (!newUser) {
            localStorage.removeItem(STORAGE_KEY);
        }
    };

    const logout = async () => {
        const response = await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin",
        });

        if (!response.ok) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.message || "Logout failed");
        }

        setUserState(null);
        setImpersonation({ isActive: false });
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.clear();
        router.replace("/login");
        router.refresh();
    };

    return (
        <AuthContext.Provider
            value={{ user, isLoading, impersonation, setImpersonation, setUser, logout }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
