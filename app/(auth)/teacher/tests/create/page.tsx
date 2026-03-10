"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { UploadCloud, Wand2, Clock, Plus, Trash2, Save, Send, AlertTriangle, BookOpen, Lock, ArrowLeft, Loader2 } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { apiClient } from "@/lib/api-client";

type QuestionOption = { id: string; text: string; isCorrect: boolean };

type Question = {
    dbId?: string;
    stem: string;
    options: QuestionOption[];
    difficulty: "EASY" | "MEDIUM" | "HARD";
    topic: string;
    explanation: string;
    saved: boolean;
};

// ... (rest of the code to maintain length limits, pasting the confirmed exact working version)

const emptyQuestion = (): Question => ({
    stem: "",
    options: [
        { id: "A", text: "", isCorrect: true },
        { id: "B", text: "", isCorrect: false },
        { id: "C", text: "", isCorrect: false },
        { id: "D", text: "", isCorrect: false },
    ],
    difficulty: "MEDIUM",
    topic: "",
    explanation: "",
    saved: false,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const normalizeOptions = (raw: any): QuestionOption[] => {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "object" && raw !== null) {
        return ["A", "B", "C", "D"].map(id => ({
            id,
            text: raw[id] || "",
            isCorrect: raw.correct === id
        }));
    }
    return emptyQuestion().options;
};

function BuilderSkeleton() {
    return (
        <div className="w-full max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-center pb-6 border-b">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>
                <Skeleton className="h-10 w-32" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <Skeleton className="col-span-3 h-[600px] rounded-3xl" />
                <Skeleton className="col-span-6 h-[600px] rounded-3xl" />
                <Skeleton className="col-span-3 h-[600px] rounded-3xl" />
            </div>
        </div>
    );
}

function TestBuilderForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const editId = searchParams.get("edit") || searchParams.get("editId");

    const [isPageLoading, setIsPageLoading] = useState(!!editId);
    const [isSaving, setIsSaving] = useState(false);
    const [openAIModal, setOpenAIModal] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // AI Imports
    const [aiBatch, setAiBatch] = useState("unassigned");
    const [aiDuration, setAiDuration] = useState("60");
    const [aiDate, setAiDate] = useState("");
    const [aiStartTime, setAiStartTime] = useState("");
    const [file, setFile] = useState<File | null>(null);

    // Test metadata
    const [testId, setTestId] = useState<string | null>(editId);
    const [testName, setTestName] = useState("");
    const [description, setDescription] = useState("");
    const [testDuration, setTestDuration] = useState("60");
    const [testDate, setTestDate] = useState("");
    const [testTime, setTestTime] = useState("");
    const [testStatus, setTestStatus] = useState("DRAFT");

    // Batches
    const [availableBatches, setAvailableBatches] = useState<{ id: string; name: string; code: string }[]>([]);
    const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
    const [isLocked, setIsLocked] = useState(false);

    // Questions
    const [questions, setQuestions] = useState<Question[]>([emptyQuestion()]);
    const [activeQIndex, setActiveQIndex] = useState(0);

    // Load available batches
    useEffect(() => {
        apiClient.get<{ batches: { id: string; name: string; code: string }[] }>("/api/teacher/batches")
            .then(res => { if (res.ok) setAvailableBatches(res.data.batches); });
    }, []);

    // Load existing test if editing
    const loadTest = useCallback(async (id: string) => {
        setIsPageLoading(true);
        const [testRes, qRes] = await Promise.all([
            apiClient.get<{ test: { id: string; title: string; description: string | null; durationMinutes: number; status: string; scheduledAt: string | null; assignments?: { batchId: string }[] } }>(`/api/teacher/tests/${id}`),
            apiClient.get<{ questions: Array<{ id: string; stem: string; options: QuestionOption[]; difficulty: string; topic: string | null; explanation: string | null }> }>(`/api/teacher/tests/${id}/questions`),
        ]);
        if (testRes.ok && testRes.data.test) {
            const t = testRes.data.test;
            setTestName(t.title);
            setDescription(t.description || "");
            setTestDuration(String(t.durationMinutes));
            setTestStatus(t.status);
            if (t.assignments) setSelectedBatchIds(t.assignments.map(a => a.batchId));
            if (t.scheduledAt) {
                const d = new Date(t.scheduledAt);
                setTestDate(d.toISOString().split("T")[0]);
                const ts = d.toTimeString().slice(0, 5);
                setTestTime(ts);

                // Lockdown if published + past scheduled time
                if (t.status === "PUBLISHED" && new Date(t.scheduledAt) <= new Date()) {
                    setIsLocked(true);
                }
            }
        }
        if (qRes.ok && qRes.data.questions.length > 0) {
            setQuestions(qRes.data.questions.map(q => ({
                dbId: q.id,
                stem: q.stem,
                options: normalizeOptions(q.options),
                difficulty: q.difficulty as "EASY" | "MEDIUM" | "HARD",
                topic: q.topic || "",
                explanation: q.explanation || "",
                saved: true,
            })));
        }
        setIsPageLoading(false);
    }, []);

    useEffect(() => {
        if (editId) loadTest(editId);
    }, [editId, loadTest]);

    const activeQ = questions[activeQIndex] || emptyQuestion();

    const updateActiveQ = (updates: Partial<Question>) => {
        setQuestions(prev => prev.map((q, i) => i === activeQIndex ? { ...q, ...updates, saved: false } : q));
    };

    const handleOptionTextChange = (optIndex: number, text: string) => {
        const newOps = [...activeQ.options];
        newOps[optIndex].text = text;
        updateActiveQ({ options: newOps });
    };

    const handleCorrectAnswerChange = (optId: string) => {
        const newOps = activeQ.options.map(o => ({ ...o, isCorrect: o.id === optId }));
        updateActiveQ({ options: newOps });
    };

    const addQuestion = () => {
        setQuestions([...questions, emptyQuestion()]);
        setActiveQIndex(questions.length);
    };

    const removeQuestion = async (index: number) => {
        if (questions.length <= 1) {
            toast.error("Test must have at least one question.");
            return;
        }
        const deletingQ = questions[index];
        if (deletingQ.dbId && testId) {
            const res = await apiClient.delete(`/api/teacher/tests/${testId}/questions/${deletingQ.dbId}`);
            if (!res.ok) {
                toast.error("Failed to delete question", { description: res.message });
                return;
            }
        }

        const newQs = questions.filter((_, i) => i !== index);
        setQuestions(newQs);
        if (activeQIndex >= newQs.length) setActiveQIndex(newQs.length - 1);
    };

    const getScheduledAt = () => {
        if (!testDate || !testTime) return undefined;
        const d = new Date(`${testDate}T${testTime}:00`);
        return isNaN(d.getTime()) ? undefined : d.toISOString();
    };

    const handleSaveTest = async (): Promise<string | null> => {
        if (!testName) { toast.error("Test name is required."); return null; }
        setIsSaving(true);
        let currentTestId = testId;
        const scheduledAt = getScheduledAt();

        try {
            if (!currentTestId) {
                const res = await apiClient.post<{ test: { id: string } }>("/api/teacher/tests", {
                    title: testName,
                    description,
                    durationMinutes: parseInt(testDuration) || 60,
                    scheduledAt,
                });
                if (!res.ok || !res.data?.test?.id) {
                    throw new Error(res.ok === false ? res.message : "Failed to create test");
                }
                currentTestId = res.data.test.id;
                setTestId(currentTestId);
            } else {
                await apiClient.patch(`/api/teacher/tests/${currentTestId}`, {
                    title: testName,
                    description,
                    durationMinutes: parseInt(testDuration) || 60,
                    scheduledAt,
                });
            }

            let savedCount = 0;
            let failedCount = 0;
            const updatedQuestions = [...questions];
            for (let i = 0; i < updatedQuestions.length; i++) {
                const q = updatedQuestions[i];
                if (q.saved || !q.stem) continue;

                if (q.dbId) {
                    const res = await apiClient.patch(`/api/teacher/tests/${currentTestId}/questions/${q.dbId}`, {
                        stem: q.stem,
                        options: q.options,
                        difficulty: q.difficulty,
                        topic: q.topic || undefined,
                        explanation: q.explanation || undefined,
                    });
                    if (res.ok) {
                        updatedQuestions[i].saved = true;
                        savedCount++;
                    } else {
                        failedCount++;
                    }
                } else {
                    const res = await apiClient.post<{ question: { id: string } }>(`/api/teacher/tests/${currentTestId}/questions`, {
                        stem: q.stem,
                        options: q.options,
                        difficulty: q.difficulty,
                        topic: q.topic || undefined,
                        explanation: q.explanation || undefined,
                    });
                    if (res.ok && res.data.question) {
                        updatedQuestions[i].dbId = res.data.question.id;
                        updatedQuestions[i].saved = true;
                        savedCount++;
                    } else {
                        failedCount++;
                    }
                }
            }

            setQuestions(updatedQuestions);

            // Draft assignment
            if (selectedBatchIds.length > 0) {
                await apiClient.post(`/api/teacher/tests/${currentTestId}/assign`, { batchIds: selectedBatchIds });
            }

            if (failedCount > 0) {
                toast.warning(`Draft Saved Partially`, { description: `Test settings saved. ${savedCount} questions saved, ${failedCount} questions failed to save (Check all options are filled).` });
            } else {
                toast.success("Draft saved successfully!", { description: savedCount > 0 ? `${savedCount} question(s) updated.` : "All questions were already up to date." });
            }
            setIsSaving(false);
            return currentTestId;
        } catch (err: any) {
            console.error("Save Test Error:", err.message);
            toast.error("Save Error", { description: err.message || "Something went wrong while saving" });
            setIsSaving(false);
            return null;
        }
    };

    const handlePublish = async () => {
        if (!testDate || !testTime) {
            toast.error("Schedule required", { description: "Set a date and time before publishing." });
            return;
        }
        if (selectedBatchIds.length === 0) {
            toast.error("Batches required", { description: "Select at least one batch to assign this test to." });
            return;
        }

        const savedId = await handleSaveTest();
        if (!savedId) return;

        setIsSaving(true);
        const res = await apiClient.patch(`/api/teacher/tests/${savedId}`, { status: "PUBLISHED" });
        if (!res.ok) {
            toast.error("Failed to publish", { description: res.message });
            setIsSaving(false);
            return;
        }

        const assignRes = await apiClient.post(`/api/teacher/tests/${savedId}/assign`, { batchIds: selectedBatchIds });
        if (!assignRes.ok) {
            toast.error("Published, but assignment failed", { description: assignRes.message });
            setIsSaving(false);
            return;
        }

        toast.success("Test Published!", { description: "Students in selected batches can access this test at the scheduled time." });
        setTestStatus("PUBLISHED");
        router.push("/teacher/dashboard");
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setFile(e.target.files[0]);
        }
    };

    const handleAIGenerate = async () => {
        if (!file) {
            toast.error("File Required", { description: "Please upload a .docx file first." });
            return;
        }
        if (!file.name.toLowerCase().endsWith('.docx')) {
            toast.error("Invalid file type", { description: "Only .docx files are supported." });
            return;
        }
        setOpenAIModal(false);
        setIsGenerating(true);
        toast.info("Analyzing Document...", { description: "AI is extracting insights and generating questions. This may take a minute." });

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('count', '100'); // Extract virtually all questions in the document
            formData.append('title', `AI Test — ${file.name.replace('.docx', '')}`);

            const res = await fetch('/api/teacher/tests/generate-from-doc', {
                method: 'POST',
                body: formData,
            });
            const data = await res.json();

            if (!res.ok) {
                if (res.status === 429) {
                    toast.error("Rate Limit Reached", { description: data.message || `Try again in ${data.retryAfter}s.` });
                } else {
                    toast.error("Generation Failed", { description: data.message || 'Something went wrong.' });
                }
                setIsGenerating(false);
                return;
            }

            const { test, questionsGenerated, failedCount } = data;
            setIsGenerating(false);

            if (failedCount > 0) {
                toast.warning(`Generated with warnings`, { description: `${questionsGenerated} questions created, ${failedCount} failed validation.` });
            } else {
                toast.success("AI generation complete!", { description: `${questionsGenerated} questions generated successfully.` });
            }

            // Redirect to the editor for the newly created test
            router.push(`/teacher/tests/create?edit=${test.id}`);
        } catch (err) {
            console.error('[AI] Document upload failed:', err);
            toast.error("Upload Failed", { description: "Could not process the document. Please try again." });
            setIsGenerating(false);
        }
    };

    if (isPageLoading) return <BuilderSkeleton />;

    return (
        <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto pb-10">
            {/* Header & Settings Row */}
            {isLocked && (
                <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl p-4 flex items-start gap-3 w-full max-w-6xl mx-auto mb-2 shadow-sm">
                    <Lock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                        <h4 className="font-bold text-amber-900">This test is locked</h4>
                        <p className="text-sm opacity-90 mt-1 font-medium">This test is published and its scheduled start time has passed. Editing is disabled to preserve the integrity of student results.</p>
                    </div>
                </div>
            )}

            <div className="flex flex-col lg:flex-row items-center justify-between border-b pb-6 gap-4 w-full max-w-6xl mx-auto" style={{ borderColor: 'var(--border-soft)' }}>
                <div>
                    <h1 className="text-3xl font-serif font-bold text-slate-900 tracking-tight flex items-center gap-3">
                        Test Builder
                        <Badge variant="outline" className={`border-none px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase ${testStatus === 'PUBLISHED' ? 'bg-emerald-50 text-emerald-700' :
                            testStatus === 'DRAFT' ? 'bg-amber-50 text-amber-700' :
                                'bg-slate-100 text-slate-500'
                            }`}>{testStatus}</Badge>
                    </h1>
                    <p className="text-slate-500 mt-1">Create manually or import a document to magically generate questions.</p>
                </div>
                <div className="flex gap-3 w-full sm:w-auto">
                    <Button onClick={() => setOpenAIModal(true)} disabled={isLocked} variant="outline" className="flex-1 sm:flex-none h-11 px-5 rounded-xl border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 font-bold shadow-sm transition-all group">
                        <Wand2 className="h-4 w-4 mr-2 text-indigo-500 group-hover:rotate-12 transition-transform" /> Import via AI
                    </Button>
                </div>
            </div>

            {isGenerating && (
                <div className="w-full max-w-6xl mx-auto bg-indigo-600 rounded-3xl p-8 text-white flex flex-col items-center justify-center min-h-[400px] shadow-clay-outer relative overflow-hidden">
                    <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent"></div>
                    <Loader2 className="h-16 w-16 animate-spin mb-6 text-indigo-200 relative z-10" />
                    <h2 className="text-2xl font-serif font-bold relative z-10">Weaving magic...</h2>
                    <p className="text-indigo-200 mt-2 relative z-10 font-medium">Extracting concepts and generating questions from your document.</p>
                </div>
            )}

            {!isGenerating && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full max-w-6xl mx-auto items-start">
                    {/* Left: Questions List */}
                    <Card className="lg:col-span-3 bg-white h-[calc(100vh-220px)] flex flex-col overflow-hidden p-0 border-0 shadow-clay-outer rounded-3xl">
                        <div className="py-5 px-5 border-b bg-surface flex justify-between items-center" style={{ borderColor: 'var(--border-soft)' }}>
                            <h2 className="text-lg font-serif font-bold text-slate-800">Questions</h2>
                            <span className="text-xs font-semibold text-slate-500 bg-slate-200 px-2.5 py-0.5 rounded-full">{questions.length}</span>
                        </div>
                        <div className="flex-1 overflow-auto bg-white">
                            <div className="flex flex-col">
                                {questions.map((q, i) => (
                                    <div
                                        key={i}
                                        onClick={() => setActiveQIndex(i)}
                                        className={`p-4 border-b border-slate-100 cursor-pointer border-l-4 transition-colors flex items-start justify-between gap-2 ${i === activeQIndex ? "bg-indigo-50 border-l-indigo-600" : "border-l-transparent hover:bg-slate-50"
                                            }`}
                                    >
                                        <p className={`text-sm font-medium line-clamp-2 flex-1 ${i === activeQIndex ? "text-slate-900" : "text-slate-600"}`}>
                                            Q{i + 1}. {q.stem || "(empty question)"}
                                        </p>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {q.saved && <span className="w-2 h-2 bg-emerald-500 rounded-full" title="Saved" />}
                                            {questions.length > 1 && (
                                                <button onClick={(e) => { e.stopPropagation(); removeQuestion(i); }} disabled={isLocked} className="text-slate-400 hover:text-red-500 p-0.5 disabled:opacity-50 disabled:cursor-not-allowed" title="Delete question">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-4 border-t bg-surface" style={{ borderColor: 'var(--border-soft)' }}>
                            <Button variant="outline" onClick={addQuestion} disabled={isLocked} className="w-full bg-white shadow-sm border-slate-200 font-bold text-slate-700 h-11 rounded-xl hover:text-primary transition-colors disabled:opacity-50">
                                <Plus className="h-4 w-4 mr-2" /> Add Question
                            </Button>
                        </div>
                    </Card>

                    {/* Middle: Question Editor */}
                    <Card className="lg:col-span-6 bg-white h-auto border-0 p-0 overflow-hidden shadow-clay-outer rounded-3xl">
                        <div className="py-5 px-6 border-b bg-surface flex justify-between items-center" style={{ borderColor: 'var(--border-soft)' }}>
                            <h2 className="text-lg font-serif font-bold text-slate-800">Question {activeQIndex + 1} Editor</h2>
                            {!activeQ.saved && activeQ.stem && <Badge className="bg-amber-100 text-amber-700 border-0 text-[10px]">Unsaved</Badge>}
                        </div>
                        <CardContent className="p-8 flex flex-col gap-8">
                            <div className="space-y-3">
                                <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider">Question Stem</Label>
                                <Textarea
                                    placeholder="Enter your question here (min 10 characters)..."
                                    className="min-h-[120px] resize-none bg-surface-2 border-transparent focus-visible:ring-indigo-500 p-4 text-base font-medium text-slate-900 rounded-2xl disabled:opacity-60"
                                    value={activeQ.stem}
                                    onChange={e => updateActiveQ({ stem: e.target.value })}
                                    disabled={isLocked}
                                />
                            </div>

                            <div className="space-y-4">
                                <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider mb-2 block border-t pt-6 border-slate-100">Answer Options</Label>
                                {activeQ.options.map((opt, i) => (
                                    <Input
                                        key={opt.id}
                                        placeholder={`Option ${opt.id}`}
                                        value={opt.text}
                                        onChange={e => handleOptionTextChange(i, e.target.value)}
                                        disabled={isLocked}
                                        className="bg-surface-2 font-medium text-slate-900 border-transparent h-12 focus-visible:ring-indigo-500 rounded-xl px-4 disabled:opacity-60"
                                    />
                                ))}
                            </div>

                            <div className="space-y-4 pt-6 border-t border-slate-100">
                                <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider flex items-center justify-between">
                                    <span>Select correct answer</span>
                                    {(!activeQ.options.some(o => o.isCorrect)) && <span className="text-rose-500 bg-rose-50 px-2 py-0.5 rounded-full text-[9px]">Required</span>}
                                </Label>
                                <RadioGroup disabled={isLocked} value={activeQ.options.find(o => o.isCorrect)?.id || "A"} onValueChange={handleCorrectAnswerChange} className="grid grid-cols-2 gap-4">
                                    {activeQ.options.map((opt) => (
                                        <Label
                                            key={opt.id}
                                            htmlFor={`correct-${opt.id}`}
                                            className={`flex items-center space-x-3 border p-4 rounded-xl cursor-pointer transition-colors shadow-sm focus-within:ring-2 ring-indigo-500 ${opt.isCorrect ? "border-indigo-300 bg-indigo-50" : "border-slate-200/60 bg-white hover:bg-indigo-50/50 hover:border-indigo-200"} ${isLocked && "opacity-60 cursor-not-allowed"}`}
                                        >
                                            <RadioGroupItem value={opt.id} id={`correct-${opt.id}`} disabled={isLocked} />
                                            <span className="cursor-pointer flex-1 font-bold text-slate-700">
                                                Option {opt.id} {opt.isCorrect && "✓"}
                                            </span>
                                        </Label>
                                    ))}
                                </RadioGroup>
                            </div>

                            <div className="grid grid-cols-2 gap-6 pt-6 border-t border-slate-100">
                                <div className="space-y-3">
                                    <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider">Topic</Label>
                                    <Input disabled={isLocked} value={activeQ.topic} onChange={e => updateActiveQ({ topic: e.target.value })} placeholder="e.g. Thermodynamics" className="bg-surface-2 border-transparent h-12 rounded-xl px-4 font-bold text-slate-900 disabled:opacity-60" />
                                </div>
                                <div className="space-y-3">
                                    <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider">Difficulty</Label>
                                    <Select disabled={isLocked} value={activeQ.difficulty} onValueChange={(v) => updateActiveQ({ difficulty: v as "EASY" | "MEDIUM" | "HARD" })}>
                                        <SelectTrigger className="bg-surface-2 border-transparent h-12 rounded-xl px-4 font-bold text-slate-800 disabled:opacity-60">
                                            <SelectValue placeholder="Select level" />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border-slate-200 font-medium">
                                            <SelectItem value="EASY">Easy</SelectItem>
                                            <SelectItem value="MEDIUM">Medium</SelectItem>
                                            <SelectItem value="HARD">Hard</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Right: Test Settings */}
                    <Card className="lg:col-span-3 bg-white h-auto flex flex-col border-0 p-0 overflow-hidden shadow-clay-outer rounded-3xl">
                        <div className="py-5 px-6 border-b bg-surface" style={{ borderColor: 'var(--border-soft)' }}>
                            <h2 className="text-lg font-serif font-bold text-slate-800">Test Settings</h2>
                        </div>
                        <CardContent className="p-6 flex-1 flex flex-col gap-6">
                            <div className="space-y-3">
                                <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider">Test Name</Label>
                                <Input disabled={isLocked} value={testName} onChange={e => setTestName(e.target.value)} placeholder="e.g. Physics Mid-Term" className="bg-surface-2 border-transparent h-12 rounded-xl px-4 font-bold text-slate-900 disabled:opacity-60" />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider">Description</Label>
                                <Textarea
                                    disabled={isLocked}
                                    className="resize-none h-24 bg-surface-2 border-transparent rounded-xl p-4 font-medium text-slate-800 disabled:opacity-60"
                                    value={description}
                                    onChange={e => setDescription(e.target.value)}
                                    placeholder="Provide instructions or context..."
                                />
                            </div>

                            <div className="pt-4 border-t border-slate-100 space-y-4">
                                <h3 className="font-serif font-bold text-slate-800 text-sm">Schedule Test</h3>
                                <div className="space-y-3">
                                    <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider flex items-center gap-1.5">Date</Label>
                                    <Input disabled={isLocked} type="date" value={testDate} onChange={e => setTestDate(e.target.value)} className="bg-surface-2 border-transparent h-12 rounded-xl px-4 font-bold text-slate-900 disabled:opacity-60" />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-3">
                                        <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Start Time</Label>
                                        <Input disabled={isLocked} type="time" value={testTime} onChange={e => setTestTime(e.target.value)} className="bg-surface-2 border-transparent h-12 rounded-xl px-4 font-bold text-slate-900 disabled:opacity-60" />
                                    </div>
                                    <div className="space-y-3">
                                        <Label className="text-slate-700 font-bold uppercase text-[11px] tracking-wider flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> Duration</Label>
                                        <Input disabled={isLocked} type="number" value={testDuration} onChange={e => setTestDuration(e.target.value)} min={5} max={300} className="bg-surface-2 border-transparent h-12 rounded-xl px-4 font-bold text-slate-900 disabled:opacity-60" />
                                    </div>
                                </div>
                            </div>

                            {/* Batch Assignment */}
                            <div className="pt-4 border-t border-slate-100 space-y-4">
                                <h3 className="font-serif font-bold text-slate-800 text-sm">Assign to Batches</h3>
                                {availableBatches.length === 0 ? (
                                    <p className="text-sm text-slate-500 italic">No batches allocated to you.</p>
                                ) : (
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                        {availableBatches.map(batch => (
                                            <div key={batch.id} className={`flex items-center space-x-3 p-3 rounded-xl border border-slate-100 transition-colors ${isLocked ? "opacity-60" : "hover:bg-slate-50"}`}>
                                                <Checkbox
                                                    id={`batch-${batch.id}`}
                                                    checked={selectedBatchIds.includes(batch.id)}
                                                    disabled={isLocked}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) setSelectedBatchIds([...selectedBatchIds, batch.id]);
                                                        else setSelectedBatchIds(selectedBatchIds.filter(id => id !== batch.id));
                                                    }}
                                                />
                                                <div className="flex-1">
                                                    <Label htmlFor={`batch-${batch.id}`} className={`font-bold text-slate-800 block ${isLocked ? "" : "cursor-pointer"}`}>{batch.name}</Label>
                                                    <p className="text-xs text-slate-400 mt-0.5">{batch.code}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </CardContent>
                        <div className="p-6 border-t bg-surface flex flex-col gap-3" style={{ borderColor: 'var(--border-soft)' }}>
                            <Button onClick={handleSaveTest} disabled={isSaving || isLocked} variant="outline" className="w-full h-12 rounded-xl text-base font-bold border-slate-200 shadow-sm disabled:opacity-60">
                                <Save className="h-4 w-4 mr-2" /> {isSaving ? "Saving..." : "Save Draft"}
                            </Button>
                            <Button onClick={handlePublish} disabled={isSaving || isLocked} className="w-full h-12 rounded-xl text-base font-bold bg-indigo-600 hover:bg-indigo-700 shadow-clay-inner disabled:opacity-60">
                                <Send className="h-4 w-4 mr-2" /> Publish & Assign
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            <Dialog open={openAIModal} onOpenChange={setOpenAIModal}>
                <DialogContent className="rounded-3xl border-0 shadow-clay-outer p-0 overflow-hidden sm:max-w-md">
                    <div className="bg-indigo-600 p-8 text-center relative overflow-hidden">
                        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent"></div>
                        <Wand2 className="h-12 w-12 text-indigo-200 mx-auto mb-4 relative z-10" />
                        <DialogTitle className="text-2xl font-serif text-white relative z-10">AI Test Generator</DialogTitle>
                        <DialogDescription className="text-indigo-100 mt-2 text-center relative z-10 font-medium">
                            Upload a document and our AI will automatically extract key concepts and generate questions.
                        </DialogDescription>
                    </div>
                    <div className="p-8 pb-10 space-y-6 bg-surface">
                        <div className="relative border-2 border-dashed border-indigo-200 rounded-2xl p-8 text-center bg-indigo-50/50 hover:bg-indigo-50 transition-colors cursor-pointer group hover:border-indigo-400">
                            <UploadCloud className="h-10 w-10 text-indigo-400 mx-auto mb-3 group-hover:-translate-y-1 transition-transform" />
                            <p className="text-sm font-bold text-slate-700">Click to upload or drag and drop</p>
                            <p className="text-xs font-medium text-slate-500 mt-1">.docx only (Max 5MB)</p>
                            <input type="file" className="hidden" id="file-upload" accept=".docx" onChange={handleFileChange} />
                            <label htmlFor="file-upload" className="absolute inset-0 cursor-pointer"></label>
                        </div>
                        {file && (
                            <div className="bg-white p-3 rounded-xl border border-emerald-100 flex items-center text-sm font-bold text-emerald-700 shadow-sm">
                                <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center mr-3">✓</div>
                                {file.name}
                            </div>
                        )}
                        <div className="space-y-4 pt-2 border-t border-slate-100">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-slate-600 font-bold text-xs uppercase tracking-wider">Date</Label>
                                    <Input type="date" value={aiDate} onChange={e => setAiDate(e.target.value)} className="bg-white border-slate-200 h-11 rounded-xl" />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-slate-600 font-bold text-xs uppercase tracking-wider">Start Time</Label>
                                    <Input type="time" value={aiStartTime} onChange={e => setAiStartTime(e.target.value)} className="bg-white border-slate-200 h-11 rounded-xl" />
                                </div>
                            </div>
                        </div>
                        <Button onClick={handleAIGenerate} disabled={!file} className="w-full h-12 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-clay-inner">
                            Generate Questions <Wand2 className="w-4 h-4 ml-2" />
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function TestBuilderPage() {
    return (
        <Suspense fallback={<BuilderSkeleton />}>
            <TestBuilderForm />
        </Suspense>
    );
}
