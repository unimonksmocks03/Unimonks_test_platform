"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Grid3X3, ArrowRight, ArrowLeft, Focus, Clock3, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { apiClient } from "@/lib/api-client";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { SharedContextRenderer } from "@/components/test/shared-context-renderer";
import type { QuestionReferencePayload } from "@/lib/types/question-reference";

// ── Types ──
interface QuestionOption {
    id: string;
    text: string;
}

interface Question {
    id: string;
    order: number;
    stem: string;
    sharedContext?: string | null;
    references?: QuestionReferencePayload[];
    options: QuestionOption[];
    difficulty?: string;
    topic?: string;
}

interface AnswerEntry {
    questionId: string;
    optionId: string | null;
    markedForReview?: boolean;
    answeredAt: string;
}

interface StartResponse {
    sessionId: string;
    questions: Question[];
    serverDeadline: string;
    durationMinutes: number;
    answers: AnswerEntry[];
    resumed: boolean;
}

// ── Component ──
export default function TestInterfaceClient({ testId }: { testId: string }) {
    const router = useRouter();

    // State
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [questions, setQuestions] = useState<Question[]>([]);
    const [answers, setAnswers] = useState<AnswerEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0); // seconds
    const [navigatorOpen, setNavigatorOpen] = useState(true);
    const [warnings, setWarnings] = useState(0);
    const [submitted, setSubmitted] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    // Refs for batch sync
    const deadlineRef = useRef<number>(0);
    const dirtyRef = useRef(false); // tracks if answers changed since last sync
    const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const syncPromiseRef = useRef<Promise<boolean> | null>(null);

    // localStorage key for this session
    const storageKey = useCallback((sid: string) => `arena:answers:${sid}`, []);

    // ── Start / Resume Session ──
    useEffect(() => {
        (async () => {
            const res = await apiClient.post<StartResponse>("/api/arena/start", { testId });

            if (!res.ok) {
                setError(res.message || "Failed to start test");
                setLoading(false);
                return;
            }

            const sid = res.data.sessionId;
            setSessionId(sid);
            sessionIdRef.current = sid;
            setQuestions(res.data.questions);

            // Restore answers: prefer localStorage (most recent), fall back to server
            const localRaw = localStorage.getItem(storageKey(sid));
            const localAnswers: AnswerEntry[] = localRaw ? JSON.parse(localRaw) : null;
            const serverAnswers = res.data.answers || [];

            if (localAnswers && localAnswers.length >= serverAnswers.length) {
                setAnswers(localAnswers);
                dirtyRef.current = true; // schedule a sync to push local state to server
            } else {
                setAnswers(serverAnswers);
                if (serverAnswers.length > 0) {
                    localStorage.setItem(storageKey(sid), JSON.stringify(serverAnswers));
                }
            }

            // Calculate time left from server deadline
            const deadline = new Date(res.data.serverDeadline).getTime();
            deadlineRef.current = deadline;
            const remaining = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
            setTimeLeft(remaining);

            if (res.data.resumed) {
                toast.info("Session Resumed", { description: "Continuing from where you left off." });
            } else {
                toast.success("Test Started!", { description: `${res.data.questions.length} questions · ${res.data.durationMinutes} minutes` });
            }

            setLoading(false);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [testId]);

    // ── Server-Authoritative Timer ──
    useEffect(() => {
        if (loading || submitted || !sessionId) return;

        const interval = setInterval(() => {
            const remaining = Math.max(0, Math.floor((deadlineRef.current - Date.now()) / 1000));
            setTimeLeft(remaining);

            if (remaining <= 0) {
                clearInterval(interval);
                handleSubmit(true);
            }
        }, 1000);

        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, submitted, sessionId]);

    // ── Batch Sync: push dirty answers to server every 15s ──
    const syncAnswersToServer = useCallback(async (force = false) => {
        const sid = sessionIdRef.current;
        if (!sid) return true;
        if (syncPromiseRef.current) return syncPromiseRef.current;
        if (!dirtyRef.current && !force) return true;

        const localRaw = localStorage.getItem(storageKey(sid));
        const localAnswers: AnswerEntry[] = localRaw ? JSON.parse(localRaw) : [];

        const syncPromise = (async () => {
            try {
                const res = await apiClient.post<{ saved: boolean }>(`/api/arena/${sid}/batch-answer`, { answers: localAnswers });
                if (!res.ok) {
                    dirtyRef.current = true;
                    return false;
                }

                dirtyRef.current = false;
                return true;
            } catch {
                dirtyRef.current = true;
                return false;
            } finally {
                syncPromiseRef.current = null;
            }
        })();

        syncPromiseRef.current = syncPromise;
        return syncPromise;
    }, [storageKey]);

    useEffect(() => {
        if (!sessionId || submitted) return;

        // Periodic batch sync every 15 seconds
        syncIntervalRef.current = setInterval(syncAnswersToServer, 15000);

        // Also sync server time every 60s
        const timeSync = setInterval(async () => {
            const res = await apiClient.get(`/api/arena/${sessionId}/status`);
            if (res.ok) {
                const data = res.data as { timeRemaining: number };
                deadlineRef.current = Date.now() + data.timeRemaining * 1000;
            }
        }, 60000);

        return () => {
            if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
            clearInterval(timeSync);
        };
    }, [sessionId, submitted, syncAnswersToServer]);

    // ── Anti-cheat: Tab Switch Detection ──
    useEffect(() => {
        if (!sessionId || submitted) return;

        let isInitialMount = true;
        const mountTimer = setTimeout(() => {
            isInitialMount = false;
        }, 1500);

        const handleContextMenu = (e: MouseEvent) => e.preventDefault();

        const handleBlur = async () => {
            if (isInitialMount || !sessionId) return;

            // Immediately sync answers on tab switch (crash protection)
            void syncAnswersToServer(true);

            setWarnings(prev => {
                const newCount = prev + 1;
                toast.error(`Focus Lost (${newCount}/3 Warning)`, {
                    description: newCount >= 3
                        ? "Test will be auto-submitted!"
                        : "Please remain in the active test window.",
                    duration: 5000,
                });
                return newCount;
            });

            // Send flag to server
            await apiClient.post(`/api/arena/${sessionId}/flag`, { type: "TAB_SWITCH" });
        };

        window.addEventListener("blur", handleBlur);
        window.addEventListener("contextmenu", handleContextMenu);

        return () => {
            clearTimeout(mountTimer);
            window.removeEventListener("blur", handleBlur);
            window.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [sessionId, submitted, syncAnswersToServer]);

    // Check if auto-submitted from flag response
    useEffect(() => {
        if (warnings >= 3 && !submitted) {
            handleSubmit(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [warnings]);

    // ── Helper: persist answers to localStorage ──
    const persistToLocal = useCallback((updatedAnswers: AnswerEntry[]) => {
        const sid = sessionIdRef.current;
        if (sid) {
            localStorage.setItem(storageKey(sid), JSON.stringify(updatedAnswers));
            dirtyRef.current = true;
        }
    }, [storageKey]);

    // ── Answer Selection ──
    const handleSelectAnswer = (optionId: string) => {
        const question = questions[currentIndex];
        if (!question || submitted) return;

        setAnswers(prev => {
            const existing = prev.findIndex(a => a.questionId === question.id);
            const entry: AnswerEntry = {
                questionId: question.id,
                optionId,
                answeredAt: new Date().toISOString(),
            };
            let updated: AnswerEntry[];
            if (existing >= 0) {
                updated = [...prev];
                updated[existing] = { ...updated[existing], ...entry };
            } else {
                updated = [...prev, entry];
            }
            persistToLocal(updated);
            return updated;
        });
    };

    // ── Clear Answer ──
    const handleClear = () => {
        const question = questions[currentIndex];
        if (!question || submitted) return;

        setAnswers(prev => {
            const updated = prev.filter(a => a.questionId !== question.id);
            persistToLocal(updated);
            return updated;
        });
    };

    // ── Mark for Review ──
    const handleMarkForReview = () => {
        const question = questions[currentIndex];
        if (!question || submitted) return;

        setAnswers(prev => {
            const existing = prev.findIndex(a => a.questionId === question.id);
            if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = { ...updated[existing], markedForReview: !updated[existing].markedForReview };
                return updated;
            }
            return [...prev, { questionId: question.id, optionId: null, markedForReview: true, answeredAt: new Date().toISOString() }];
        });

        toast.info("Question marked for review");
    };

    // ── Submit Test ──
    const handleSubmit = async (force = false) => {
        if (!sessionId || submitted || submitting) return;

        if (!force) {
            const unanswered = questions.length - answers.filter(a => a.optionId).length;
            if (unanswered > 0) {
                const confirmed = window.confirm(
                    `You have ${unanswered} unanswered question(s). Are you sure you want to submit?`
                );
                if (!confirmed) return;
            }
        }

        setSubmitting(true);

        const synced = await syncAnswersToServer(true);
        if (!synced) {
            toast.error("Could not sync your latest answers. Please try again.");
            setSubmitting(false);
            return;
        }

        const localRaw = localStorage.getItem(storageKey(sessionId));
        const latestAnswers: AnswerEntry[] = localRaw ? JSON.parse(localRaw) : answers;
        const res = await apiClient.post(`/api/arena/${sessionId}/submit`, { answers: latestAnswers });

        if (res.ok) {
            const data = res.data as { score: number; totalMarks: number; percentage: number };
            setSubmitted(true);
            // Clean up localStorage for this session
            localStorage.removeItem(storageKey(sessionId));
            toast.success(`Test Submitted! Score: ${data.score}/${data.totalMarks} (${data.percentage}%)`, {
                description: "Redirecting to results...",
                duration: 3000,
            });
            setTimeout(() => {
                router.push(`/student/results/${sessionId}`);
            }, 2000);
        } else {
            toast.error("Failed to submit test");
            setSubmitting(false);
        }
    };

    // ── Navigation ──
    const goToQuestion = (idx: number) => {
        if (idx >= 0 && idx < questions.length) setCurrentIndex(idx);
    };

    // ── Derived State ──
    const currentQuestion = questions[currentIndex];
    const currentAnswer = answers.find(a => a.questionId === currentQuestion?.id);
    const selectedOption = currentAnswer?.optionId || "";
    const answeredCount = answers.filter(a => a.optionId).length;
    const markedCount = answers.filter(a => a.markedForReview).length;
    const remaining = questions.length - answeredCount;

    const formatTime = (s: number) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    };

    const getQuestionState = (idx: number) => {
        const q = questions[idx];
        if (!q) return "not-visited";
        if (idx === currentIndex) return "current";
        const ans = answers.find(a => a.questionId === q.id);
        if (ans?.markedForReview) return "marked";
        if (ans?.optionId) return "answered";
        return "not-visited";
    };

    const navCellClass = (state: string) => {
        switch (state) {
            case "current": return "bg-indigo-600 text-white font-bold shadow-md scale-105";
            case "answered": return "bg-emerald-100 text-emerald-700 font-bold border border-emerald-200 cursor-pointer hover:bg-emerald-200";
            case "marked": return "bg-amber-100 text-amber-700 font-bold border border-amber-200 cursor-pointer hover:bg-amber-200";
            default: return "bg-surface-2 text-slate-600 font-bold border border-slate-200 hover:border-indigo-300 hover:bg-white cursor-pointer";
        }
    };

    // ── Loading State ──
    if (loading) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="text-center">
                    <Loader2 className="h-10 w-10 text-indigo-600 animate-spin mx-auto mb-4" />
                    <p className="text-lg font-serif font-bold text-slate-700">Starting Test...</p>
                    <p className="text-sm text-slate-500 mt-1">Loading questions from server</p>
                </div>
            </div>
        );
    }

    // ── Error State ──
    if (error) {
        return (
            <div className="min-h-screen bg-surface flex items-center justify-center">
                <div className="text-center max-w-md">
                    <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-xl font-serif font-bold text-slate-900 mb-2">Cannot Start Test</h2>
                    <p className="text-slate-600 mb-6">{error}</p>
                    <Button onClick={() => router.push("/student/dashboard")} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl">
                        Back to Dashboard
                    </Button>
                </div>
            </div>
        );
    }

    if (!currentQuestion) return null;

    // ── Navigator Grid ──
    const NavigatorGrid = () => (
        <>
            <div className="grid grid-cols-5 gap-3">
                {questions.map((_, idx) => (
                    <div
                        key={idx}
                        onClick={() => goToQuestion(idx)}
                        className={`aspect-square flex items-center justify-center rounded-xl text-sm transition-all ${navCellClass(getQuestionState(idx))}`}
                    >
                        {idx + 1}
                    </div>
                ))}
            </div>
            <div className="mt-8 pt-6 border-t border-slate-100 grid grid-cols-2 gap-y-4 gap-x-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-emerald-100 border border-emerald-200"></div> <span>Answered ({answeredCount})</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-amber-100 border border-amber-200"></div> <span>Marked ({markedCount})</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-indigo-600"></div> <span className="text-indigo-600">Current</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-md bg-surface-2 border border-slate-200"></div> <span>Not Visited</span>
                </div>
            </div>
        </>
    );

    return (
        <div className="min-h-screen bg-surface flex flex-col font-sans">
            {/* Top Bar */}
            <div className="h-20 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <div className="bg-indigo-600 text-white font-serif font-bold h-10 w-10 flex items-center justify-center rounded-xl shadow-inner">
                        UM
                    </div>
                    <div>
                        <h1 className="text-lg font-serif font-bold text-slate-900 leading-tight">Test Arena</h1>
                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">
                            {questions.length} Questions · {formatTime(timeLeft)} remaining
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4 sm:gap-6">
                    {/* Timer Badge */}
                    <div className={`font-mono font-bold text-lg tracking-widest px-4 py-2 rounded-xl ${timeLeft <= 300 ? "bg-rose-100 text-rose-700 animate-pulse" : "bg-slate-100 text-slate-800"}`}>
                        {formatTime(timeLeft)}
                    </div>

                    <Button variant="outline" className="hidden lg:flex border-slate-200 text-slate-600 shadow-sm" onClick={() => setNavigatorOpen(!navigatorOpen)}>
                        <Focus className="h-4 w-4 mr-2" /> {navigatorOpen ? "Focus Mode" : "Show Navigator"}
                    </Button>

                    {/* Mobile Navigator */}
                    <div className="lg:hidden relative">
                        {warnings > 0 && <div className="absolute -top-2 -right-2 bg-rose-500 text-white text-[10px] w-4 h-4 rounded-full flex items-center justify-center font-bold z-10">{warnings}</div>}
                        <Sheet>
                            <SheetTrigger asChild>
                                <Button variant="outline" className="border-slate-200 text-slate-600 shadow-sm" size="icon">
                                    <Grid3X3 className="h-5 w-5" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="bottom" className="h-[80vh] rounded-t-[2rem] border-slate-200 shadow-clay-outer p-6">
                                <SheetHeader className="mb-6 border-b border-slate-100 pb-4">
                                    <SheetTitle className="font-serif font-bold text-slate-800 text-left text-xl flex items-center gap-2">
                                        <Grid3X3 className="w-5 h-5 text-indigo-500" /> Question Navigator
                                    </SheetTitle>
                                </SheetHeader>
                                <NavigatorGrid />
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>
            </div>

            {/* Test Arena Body */}
            <div className={`p-6 md:p-10 flex-1 grid ${navigatorOpen ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1"} gap-8 mx-auto w-full max-w-[1600px] transition-all`}>
                {/* Left: Question */}
                <div className={`${navigatorOpen ? "lg:col-span-8 xl:col-span-9" : "col-span-1 max-w-4xl mx-auto w-full"} flex flex-col bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden h-[calc(100vh-160px)] transition-all`}>
                    {/* Question Header */}
                    <div className="px-10 py-6 border-b border-slate-100 flex items-center justify-between bg-surface/50">
                        <div className="flex items-center gap-3">
                            <span className="font-bold text-slate-400 uppercase tracking-widest text-sm">Question</span>
                            <div className="bg-indigo-100 text-indigo-800 font-bold px-3 py-1 rounded-lg text-lg">{currentIndex + 1}</div>
                            <span className="font-bold text-slate-400 uppercase tracking-widest text-sm">Of {questions.length}</span>
                        </div>
                        <div className="flex items-center gap-3">
                            {currentAnswer?.markedForReview && (
                                <span className="bg-amber-100 text-amber-800 px-3 py-1 rounded-md font-bold text-[10px] uppercase tracking-wider">Marked for Review</span>
                            )}
                            {currentAnswer?.optionId ? (
                                <span className="bg-emerald-100 text-emerald-800 px-3 py-1 rounded-md font-bold text-[10px] uppercase tracking-wider">Answered</span>
                            ) : (
                                <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-md font-bold text-[10px] uppercase tracking-wider">Not Answered</span>
                            )}
                        </div>
                    </div>

                    {/* Question Content */}
                    <div className="p-10 flex-1 overflow-auto">
                        {currentQuestion.sharedContext || currentQuestion.references?.length ? (
                            <div className="mb-6">
                                <SharedContextRenderer
                                    context={currentQuestion.sharedContext}
                                    references={currentQuestion.references}
                                    tone="indigo"
                                />
                            </div>
                        ) : null}
                        <h3 className="text-2xl font-serif font-bold text-slate-900 mb-10 leading-snug">
                            {currentQuestion.stem}
                        </h3>

                        <RadioGroup value={selectedOption} onValueChange={handleSelectAnswer} className="flex flex-col space-y-4 max-w-3xl">
                            {currentQuestion.options.map((opt) => (
                                <Label
                                    key={opt.id}
                                    htmlFor={`option-${opt.id}`}
                                    className="flex items-center p-5 rounded-2xl border-2 border-slate-100 bg-white hover:border-indigo-300 hover:bg-indigo-50/50 cursor-pointer transition-all focus-within:ring-2 focus-within:ring-indigo-500/20 group has-[[data-state=checked]]:border-indigo-500 has-[[data-state=checked]]:bg-indigo-50/50"
                                >
                                    <div className="flex items-center justify-center w-8 h-8 rounded-full border border-slate-300 group-has-[[data-state=checked]]:border-indigo-500 group-has-[[data-state=checked]]:bg-indigo-500 mr-4 transition-colors">
                                        <RadioGroupItem value={opt.id} id={`option-${opt.id}`} className="sr-only" />
                                        <span className="text-sm font-bold text-slate-500 group-has-[[data-state=checked]]:text-white uppercase">{opt.id}</span>
                                    </div>
                                    <span className="text-lg font-medium text-slate-700 group-has-[[data-state=checked]]:text-indigo-950 flex-1">{opt.text}</span>
                                </Label>
                            ))}
                        </RadioGroup>
                    </div>

                    {/* Footer Actions */}
                    <div className="px-10 py-6 border-t border-slate-100 bg-surface/50 flex items-center justify-between">
                        <div className="flex gap-2">
                            <Button
                                variant="ghost"
                                disabled={currentIndex === 0}
                                onClick={() => goToQuestion(currentIndex - 1)}
                                className="font-bold text-slate-500 hover:text-slate-800 rounded-xl px-6 h-12"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" /> Previous
                            </Button>
                            <Button
                                variant="ghost"
                                onClick={handleMarkForReview}
                                className={`font-bold rounded-xl px-6 h-12 ${currentAnswer?.markedForReview ? "text-amber-600 bg-amber-50" : "text-slate-500 hover:text-amber-600 hover:bg-amber-50"}`}
                            >
                                {currentAnswer?.markedForReview ? "✓ Marked" : "Mark for Review"}
                            </Button>
                        </div>
                        <div className="flex gap-4">
                            <Button variant="outline" onClick={handleClear} className="font-bold border-slate-200 text-slate-600 rounded-xl px-6 h-12">
                                Clear
                            </Button>
                            {currentIndex < questions.length - 1 ? (
                                <Button onClick={() => goToQuestion(currentIndex + 1)} className="font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 h-12 shadow-sm text-base flex items-center">
                                    Save & Next <ArrowRight className="ml-2 w-5 h-5" />
                                </Button>
                            ) : (
                                <Button onClick={() => handleSubmit(false)} disabled={submitting} className="font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl px-8 h-12 shadow-sm text-base flex items-center">
                                    {submitting ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                                    Finish Test
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right: Stats + Navigator */}
                {navigatorOpen && (
                    <div className="lg:col-span-4 xl:col-span-3 flex flex-col gap-6">
                        {/* Status Card */}
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-5 border-b border-slate-100 bg-surface flex items-center justify-between">
                                <h2 className="font-serif font-bold text-slate-800 flex items-center gap-2 text-lg">
                                    <Clock3 className="w-5 h-5 text-indigo-500" /> Test Status
                                </h2>
                                {warnings > 0 && (
                                    <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-bold text-xs">
                                        ⚠ {warnings}/3
                                    </span>
                                )}
                            </div>
                            <div className="p-6 space-y-4">
                                <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
                                    <span className="text-sm font-semibold text-slate-600">Time Remaining</span>
                                    <span className={`font-mono font-bold text-lg tracking-widest ${timeLeft <= 300 ? "text-rose-600" : "text-slate-900"}`}>
                                        {formatTime(timeLeft)}
                                    </span>
                                </div>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3">
                                        <div className="text-[10px] uppercase tracking-wider text-emerald-600 font-bold">Answered</div>
                                        <div className="text-xl font-bold text-emerald-700">{answeredCount}</div>
                                    </div>
                                    <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3">
                                        <div className="text-[10px] uppercase tracking-wider text-amber-600 font-bold">Marked</div>
                                        <div className="text-xl font-bold text-amber-700">{markedCount}</div>
                                    </div>
                                    <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3">
                                        <div className="text-[10px] uppercase tracking-wider text-indigo-600 font-bold">Answered</div>
                                        <div className="text-xl font-bold text-indigo-700">{answeredCount}/{questions.length}</div>
                                    </div>
                                    <div className="bg-slate-100 border border-slate-200 rounded-2xl p-3">
                                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Remaining</div>
                                        <div className="text-xl font-bold text-slate-700">{remaining}</div>
                                    </div>
                                </div>
                                <Button
                                    onClick={() => handleSubmit(false)}
                                    disabled={submitting}
                                    className="w-full bg-slate-900 hover:bg-black text-white font-bold rounded-xl h-12 shadow-sm"
                                >
                                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                                    Finish Test
                                </Button>
                            </div>
                        </div>

                        {/* Navigator */}
                        <div className="flex flex-col bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden sticky top-[104px]">
                            <div className="px-6 py-5 border-b border-slate-100 bg-surface flex items-center justify-between">
                                <h2 className="font-serif font-bold text-slate-800 flex items-center gap-2 text-lg">
                                    <Grid3X3 className="w-5 h-5 text-indigo-500" /> Navigator
                                </h2>
                            </div>
                            <div className="p-6">
                                <NavigatorGrid />
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
