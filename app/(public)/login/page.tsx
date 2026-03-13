"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { GraduationCap, ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Step = "email" | "otp";

export default function LoginPage() {
    const router = useRouter();
    const [step, setStep] = useState<Step>("email");
    const [email, setEmail] = useState("");
    const [otp, setOtp] = useState(["", "", "", "", "", ""]);
    const [isLoading, setIsLoading] = useState(false);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

    const handleSendOTP = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) {
            toast.error("Email Required", { description: "Please enter your registered email address." });
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch("/api/auth/send-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();

            if (res.status === 429) {
                toast.error("Too Many Requests", { description: data.message });
                setIsLoading(false);
                return;
            }

            if (!res.ok) {
                toast.error("Error", { description: data.message || "Something went wrong." });
                setIsLoading(false);
                return;
            }

            setStep("otp");
            toast.success("Check Your Email", { description: data.message || "If your account is active, a 6-digit code has been sent." });
        } catch {
            toast.error("Error", { description: "Something went wrong. Please try again." });
        }
        setIsLoading(false);
    };

    const handleOTPChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return; // Only digits
        const newOtp = [...otp];
        newOtp[index] = value.slice(-1); // Take only last digit
        setOtp(newOtp);

        // Auto-focus next input
        if (value && index < 5) {
            otpRefs.current[index + 1]?.focus();
        }
    };

    const handleOTPKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === "Backspace" && !otp[index] && index > 0) {
            otpRefs.current[index - 1]?.focus();
        }
    };

    const handleOTPPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pastedData = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (pastedData.length === 6) {
            const newOtp = pastedData.split("");
            setOtp(newOtp);
            otpRefs.current[5]?.focus();
        }
    };

    const handleVerifyOTP = async (e: React.FormEvent) => {
        e.preventDefault();
        const otpString = otp.join("");
        if (otpString.length !== 6) {
            toast.error("Incomplete OTP", { description: "Please enter the full 6-digit code." });
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch("/api/auth/verify-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, otp: otpString }),
            });
            const data = await res.json();

            if (res.status === 429) {
                toast.error("Too Many Attempts", { description: data.message });
                setIsLoading(false);
                return;
            }

            if (!res.ok) {
                toast.error("Invalid OTP", { description: data.message || "Please check your code and try again." });
                setOtp(["", "", "", "", "", ""]);
                otpRefs.current[0]?.focus();
                setIsLoading(false);
                return;
            }

            const normalizedUser = {
                ...data.user,
                role: data.user.role.toLowerCase(),
            };

            const roleName = normalizedUser.role.charAt(0).toUpperCase() + normalizedUser.role.slice(1);
            toast.success(`Welcome ${roleName}!`, { description: "Redirecting to your dashboard..." });

            // Role-based redirect
            const dashboardMap: Record<string, string> = {
                admin: "/admin/dashboard",
                teacher: "/teacher/dashboard",
                student: "/student/dashboard",
            };
            router.replace(dashboardMap[normalizedUser.role] || "/login");
        } catch {
            toast.error("Error", { description: "Something went wrong. Please try again." });
        }
        setIsLoading(false);
    };

    const handleResendOTP = async () => {
        setIsLoading(true);
        try {
            const res = await fetch("/api/auth/send-otp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();

            if (res.status === 429) {
                toast.error("Too Many Requests", { description: data.message });
            } else if (!res.ok) {
                toast.error("Error", { description: data.message || "Failed to resend OTP." });
            } else {
                toast.success("Check Your Email", { description: data.message || "If your account is active, a new code has been sent." });
            }
        } catch {
            toast.error("Error", { description: "Failed to resend OTP." });
        }
        setIsLoading(false);
    };

    return (
        <div className="max-w-md w-full mx-auto">
            <div className="mb-8 flex flex-col items-center justify-center text-center">
                <div className="h-16 w-16 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-3xl flex items-center justify-center shadow-clay-outer mb-6 rotate-3">
                    <GraduationCap className="h-8 w-8 text-white -rotate-3" />
                </div>
                <h1 className="text-4xl font-serif text-slate-900 font-extrabold tracking-tight">Unimonk</h1>
                <p className="text-slate-600 mt-3 text-sm max-w-sm">
                    Welcome back. Sign in to your account using your registered email.
                </p>
            </div>

            <Card
                className="bg-white rounded-3xl overflow-hidden border-0"
                style={{ boxShadow: "var(--shadow-clay-outer)", border: "1.5px solid rgba(121, 90, 60, 0.12)" }}
            >
                {/* Step 1: Email Input */}
                {step === "email" && (
                    <form onSubmit={handleSendOTP}>
                        <CardHeader className="space-y-1 pb-6 pt-8 px-8">
                            <div className="bg-indigo-50 p-3 rounded-2xl w-fit mb-2">
                                <Mail className="h-6 w-6 text-indigo-600" />
                            </div>
                            <CardTitle className="text-2xl font-serif font-bold text-slate-800">Sign in</CardTitle>
                            <CardDescription className="text-slate-500">
                                Enter your registered email address. We&apos;ll send you a one-time code.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5 px-8">
                            <div className="space-y-2">
                                <Label htmlFor="email" className="font-semibold text-slate-700">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="name@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="bg-surface-2 h-12 border-transparent focus-visible:ring-indigo-500 rounded-xl px-4 text-slate-900 placeholder:text-slate-400"
                                />
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-4 pb-8 px-8 pt-4">
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full rounded-2xl h-12 text-base font-bold shadow-clay-inner bg-indigo-600 hover:bg-indigo-700 transition-all hover:scale-[1.02] disabled:opacity-70"
                            >
                                {isLoading ? "Sending..." : "Send OTP"}
                            </Button>
                            <div className="text-center text-xs font-medium text-slate-500 mt-2 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                <span className="text-slate-700">No password needed!</span><br />
                                We&apos;ll send a 6-digit code to your registered email each time you log in.
                            </div>
                        </CardFooter>
                    </form>
                )}

                {/* Step 2: OTP Input */}
                {step === "otp" && (
                    <form onSubmit={handleVerifyOTP}>
                        <CardHeader className="space-y-1 pb-4 pt-8 px-8">
                            <div className="bg-emerald-50 p-3 rounded-2xl w-fit mb-2">
                                <ShieldCheck className="h-6 w-6 text-emerald-600" />
                            </div>
                            <CardTitle className="text-2xl font-serif font-bold text-slate-800">Enter OTP</CardTitle>
                            <CardDescription className="text-slate-500">
                                We sent a 6-digit code to <span className="font-bold text-slate-700">{email}</span>. It expires in 5 minutes.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5 px-8">
                            <div className="flex justify-center gap-2" onPaste={handleOTPPaste}>
                                {otp.map((digit, index) => (
                                    <Input
                                        key={index}
                                        ref={(el) => { otpRefs.current[index] = el; }}
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={1}
                                        value={digit}
                                        onChange={(e) => handleOTPChange(index, e.target.value)}
                                        onKeyDown={(e) => handleOTPKeyDown(index, e)}
                                        className="w-12 h-14 text-center text-xl font-bold bg-surface-2 border-transparent focus-visible:ring-indigo-500 rounded-xl text-slate-900"
                                        autoFocus={index === 0}
                                    />
                                ))}
                            </div>
                        </CardContent>
                        <CardFooter className="flex flex-col gap-4 pb-8 px-8 pt-2">
                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full rounded-2xl h-12 text-base font-bold shadow-clay-inner bg-indigo-600 hover:bg-indigo-700 transition-all hover:scale-[1.02] disabled:opacity-70"
                            >
                                {isLoading ? "Verifying..." : "Verify & Sign In"}
                            </Button>
                            <div className="flex items-center justify-between w-full text-sm">
                                <button
                                    type="button"
                                    onClick={() => { setStep("email"); setOtp(["", "", "", "", "", ""]); }}
                                    className="text-slate-500 hover:text-indigo-600 font-semibold transition-colors flex items-center gap-1"
                                >
                                    <ArrowLeft className="h-4 w-4" /> Change email
                                </button>
                                <button
                                    type="button"
                                    onClick={handleResendOTP}
                                    disabled={isLoading}
                                    className="text-indigo-600 hover:text-indigo-800 font-semibold transition-colors disabled:opacity-50"
                                >
                                    Resend OTP
                                </button>
                            </div>
                        </CardFooter>
                    </form>
                )}
            </Card>
        </div>
    );
}
