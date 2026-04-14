"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    Layers3,
    Loader2,
    Plus,
    Save,
    Send,
    Trash2,
    UploadCloud,
    Wand2,
} from "lucide-react";

import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { SharedContextRenderer } from "@/components/test/shared-context-renderer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { QuestionReferencePayload } from "@/lib/types/question-reference";

type QuestionOption = { id: string; text: string; isCorrect: boolean };

type Question = {
    dbId?: string;
    stem: string;
    sharedContext: string;
    references?: QuestionReferencePayload[];
    options: QuestionOption[];
    difficulty: "EASY" | "MEDIUM" | "HARD";
    topic: string;
    explanation: string;
    saved: boolean;
};

type BatchAudience = "FREE" | "PAID" | "HYBRID" | "UNASSIGNED";

type AssignedBatch = {
    id: string;
    name: string;
    code: string;
    kind: "FREE_SYSTEM" | "STANDARD";
};

type AdminTestResponse = {
    test: {
        id: string;
        title: string;
        description: string | null;
        durationMinutes: number;
        status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
        audience: BatchAudience;
        assignedBatches: AssignedBatch[];
        isEditable: boolean;
        canEditTitle: boolean;
        canEditDuration: boolean;
        canManageAssignments: boolean;
    };
};

type QuestionsResponse = {
    questions: Array<{
        id: string;
        stem: string;
        sharedContext: string | null;
        references?: QuestionReferencePayload[];
        options: QuestionOption[] | Record<string, string>;
        difficulty: "EASY" | "MEDIUM" | "HARD";
        topic: string | null;
        explanation: string | null;
    }>;
};

type BatchesResponse = {
    batches: Array<{
        id: string;
        name: string;
        code: string;
        kind: "FREE_SYSTEM" | "STANDARD";
    }>;
};

type ImportJobStatus = "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
type ImportJobStage =
    | "QUEUED"
    | "PROCESSING_CLASSIFICATION"
    | "PROCESSING_EXACT"
    | "CREATING_DRAFT"
    | "ENRICHING_REFERENCES"
    | "VERIFYING"
    | "SUCCEEDED"
    | "FAILED";

type ImportJobResultPayload = {
    test: { id: string; reviewStatus: string | null };
    strategy: "EXTRACTED" | "AI_GENERATED" | "AI_VISION_FALLBACK";
    extractedQuestions: number;
    generationTarget: number | null;
    questionsGenerated: number;
    failedCount: number;
    importDiagnostics?: {
        reviewRequired?: boolean;
        aiFallbackUsed?: boolean;
        warning?: string | null;
    } | null;
};

type ImportJobSummary = {
    id: string;
    status: ImportJobStatus;
    stage: ImportJobStage;
    stageStartedAt: string | null;
    currentStageElapsedMs: number | null;
    lane: "STABLE" | "ADVANCED" | null;
    routingMode: "LEGACY" | "CLASSIFIER" | null;
    selectedStrategy: string | null;
    resultStrategy: string | null;
    decision: "EXACT_ACCEPTED" | "REVIEW_REQUIRED" | "FAILED_WITH_REASON" | null;
    tokenCostUsd: number | null;
    totalElapsedMs: number | null;
    fileName: string;
    message: string | null;
    progressMessage: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    testId: string | null;
    result: ImportJobResultPayload | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    completedAt: string | null;
};

type ImportJobResponse = {
    job: ImportJobSummary;
};

type SaveDraftOptions = {
    showSuccessToast?: boolean;
};

type AssignOptions = {
    showSuccessToast?: boolean;
    testOverrideId?: string;
};

const emptyQuestion = (): Question => ({
    stem: "",
    sharedContext: "",
    references: [],
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
        return ["A", "B", "C", "D"].map((id) => ({
            id,
            text: raw[id] || "",
            isCorrect: raw.correct === id,
        }));
    }
    return emptyQuestion().options;
};

function audienceBadgeClass(audience: BatchAudience) {
    if (audience === "FREE") return "bg-sky-50 text-sky-700 border-none";
    if (audience === "PAID") return "bg-violet-50 text-violet-700 border-none";
    if (audience === "HYBRID") return "bg-emerald-50 text-emerald-700 border-none";
    return "bg-slate-100 text-slate-600 border-none";
}

function audienceLabel(audience: BatchAudience) {
    if (audience === "UNASSIGNED") return "Unassigned";
    if (audience === "HYBRID") return "Free + Paid";
    return audience;
}

function formatImportStage(stage: ImportJobStage | null | undefined) {
    switch (stage) {
        case "PROCESSING_CLASSIFICATION":
            return "Classifying";
        case "PROCESSING_EXACT":
            return "Extracting";
        case "CREATING_DRAFT":
            return "Creating Draft";
        case "ENRICHING_REFERENCES":
            return "Enriching References";
        case "VERIFYING":
            return "Verifying";
        case "SUCCEEDED":
            return "Complete";
        case "FAILED":
            return "Failed";
        case "QUEUED":
        default:
            return "Queued";
    }
}

function formatElapsedMs(elapsedMs: number | null | undefined) {
    if (!elapsedMs || elapsedMs < 1000) {
        return null;
    }

    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    }

    return `${seconds}s`;
}

function BuilderSkeleton() {
    return (
        <div className="mx-auto w-full max-w-6xl space-y-6">
            <div className="flex items-center justify-between border-b pb-6">
                <div className="space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-4 w-96" />
                </div>
                <Skeleton className="h-10 w-36" />
            </div>
            <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                <Skeleton className="col-span-3 h-[600px] rounded-3xl" />
                <Skeleton className="col-span-6 h-[600px] rounded-3xl" />
                <Skeleton className="col-span-3 h-[600px] rounded-3xl" />
            </div>
        </div>
    );
}

function AdminTestBuilderForm() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const editId = searchParams.get("edit") || searchParams.get("editId");

    const [isPageLoading, setIsPageLoading] = useState(!!editId);
    const [isSavingDraft, setIsSavingDraft] = useState(false);
    const [isAssigning, setIsAssigning] = useState(false);
    const [isPublishing, setIsPublishing] = useState(false);
    const [openAIModal, setOpenAIModal] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [importJob, setImportJob] = useState<ImportJobSummary | null>(null);

    const [testId, setTestId] = useState<string | null>(editId);
    const [testName, setTestName] = useState("");
    const [description, setDescription] = useState("");
    const [testDuration, setTestDuration] = useState("60");
    const [savedDuration, setSavedDuration] = useState("60");
    const [savedTitle, setSavedTitle] = useState("");
    const [testStatus, setTestStatus] = useState<"DRAFT" | "PUBLISHED" | "ARCHIVED">("DRAFT");
    const [savedAudience, setSavedAudience] = useState<BatchAudience>("UNASSIGNED");

    const [availableBatches, setAvailableBatches] = useState<Array<{ id: string; name: string; code: string; kind: "FREE_SYSTEM" | "STANDARD" }>>([]);
    const [selectedBatchIds, setSelectedBatchIds] = useState<string[]>([]);
    const [isContentLocked, setIsContentLocked] = useState(false);
    const [canEditTitle, setCanEditTitle] = useState(true);
    const [canEditDuration, setCanEditDuration] = useState(true);
    const [canManageAssignments, setCanManageAssignments] = useState(true);

    const [questions, setQuestions] = useState<Question[]>([emptyQuestion()]);
    const [activeQIndex, setActiveQIndex] = useState(0);

    useEffect(() => {
        apiClient.get<BatchesResponse>("/api/admin/batches", { limit: 100 }).then((response) => {
            if (!response.ok) {
                toast.error("Failed to load batches", { description: response.message });
                return;
            }

            const sortedBatches = [...response.data.batches].sort((left, right) => left.name.localeCompare(right.name));
            setAvailableBatches(sortedBatches);
        });
    }, []);

    const loadTest = useCallback(async (id: string) => {
        setIsPageLoading(true);
        const [testResponse, questionsResponse] = await Promise.all([
            apiClient.get<AdminTestResponse>(`/api/admin/tests/${id}`),
            apiClient.get<QuestionsResponse>(`/api/admin/tests/${id}/questions`),
        ]);

        if (!testResponse.ok) {
            toast.error("Failed to load test", { description: testResponse.message });
            router.push("/admin/tests");
            return;
        }

        const test = testResponse.data.test;
        setTestId(test.id);
        setTestName(test.title);
        setSavedTitle(test.title);
        setDescription(test.description || "");
        const durationValue = String(test.durationMinutes);
        setTestDuration(durationValue);
        setSavedDuration(durationValue);
        setTestStatus(test.status);
        setSavedAudience(test.audience);
        setSelectedBatchIds(test.assignedBatches.map((batch) => batch.id));
        setIsContentLocked(!test.isEditable);
        setCanEditTitle(test.canEditTitle);
        setCanEditDuration(test.canEditDuration);
        setCanManageAssignments(test.canManageAssignments);

        if (questionsResponse.ok && questionsResponse.data.questions.length > 0) {
            setQuestions(
                questionsResponse.data.questions.map((question) => ({
                    dbId: question.id,
                    stem: question.stem,
                    sharedContext: question.sharedContext || "",
                    references: question.references || [],
                    options: normalizeOptions(question.options),
                    difficulty: question.difficulty,
                    topic: question.topic || "",
                    explanation: question.explanation || "",
                    saved: true,
                }))
            );
        }

        if (!questionsResponse.ok) {
            toast.error("Failed to load questions", { description: questionsResponse.message });
        }

        setIsPageLoading(false);
    }, [router]);

    useEffect(() => {
        if (editId) {
            void loadTest(editId);
        }
    }, [editId, loadTest]);

    const activeQuestion = questions[activeQIndex] || emptyQuestion();
    const isBusy = isSavingDraft || isAssigning || isPublishing || isGenerating;
    const isPublishedTest = testStatus === "PUBLISHED";
    const normalizedDuration = String(Number.parseInt(testDuration, 10) || 60);
    const hasPublishedDurationChange = isPublishedTest && normalizedDuration !== savedDuration;
    const hasPublishedTitleChange = isPublishedTest && testName.trim() !== savedTitle.trim();

    const updateActiveQuestion = (updates: Partial<Question>) => {
        setQuestions((currentQuestions) =>
            currentQuestions.map((question, index) =>
                index === activeQIndex ? { ...question, ...updates, saved: false } : question
            )
        );
    };

    const handleOptionTextChange = (optionIndex: number, text: string) => {
        const nextOptions = [...activeQuestion.options];
        nextOptions[optionIndex].text = text;
        updateActiveQuestion({ options: nextOptions });
    };

    const handleCorrectAnswerChange = (optionId: string) => {
        const nextOptions = activeQuestion.options.map((option) => ({
            ...option,
            isCorrect: option.id === optionId,
        }));
        updateActiveQuestion({ options: nextOptions });
    };

    const addQuestion = () => {
        setQuestions((currentQuestions) => [...currentQuestions, emptyQuestion()]);
        setActiveQIndex(questions.length);
    };

    const removeQuestion = async (index: number) => {
        if (questions.length <= 1) {
            toast.error("Test must have at least one question.");
            return;
        }

        const deletingQuestion = questions[index];
        if (deletingQuestion.dbId && testId) {
            const response = await apiClient.delete<{ message: string }>(
                `/api/admin/tests/${testId}/questions/${deletingQuestion.dbId}`
            );

            if (!response.ok) {
                toast.error("Failed to delete question", { description: response.message });
                return;
            }
        }

        const remainingQuestions = questions.filter((_, questionIndex) => questionIndex !== index);
        setQuestions(remainingQuestions);
        if (activeQIndex >= remainingQuestions.length) {
            setActiveQIndex(Math.max(0, remainingQuestions.length - 1));
        }
    };

    const saveDraft = useCallback(async (options?: SaveDraftOptions): Promise<string | null> => {
        const showSuccessToast = options?.showSuccessToast ?? true;

        if (!testName.trim()) {
            toast.error("Test name is required.");
            return null;
        }

        setIsSavingDraft(true);
        let currentTestId = testId;

        try {
            if (!currentTestId) {
                const createResponse = await apiClient.post<{ test: { id: string } }>("/api/admin/tests", {
                    title: testName.trim(),
                    description: description.trim() || undefined,
                    durationMinutes: Number.parseInt(testDuration, 10) || 60,
                });

                if (!createResponse.ok || !createResponse.data.test?.id) {
                    throw new Error(createResponse.ok ? "Failed to create test" : createResponse.message);
                }

                currentTestId = createResponse.data.test.id;
                setTestId(currentTestId);
                setSavedTitle(testName.trim());
                setSavedDuration(String(Number.parseInt(testDuration, 10) || 60));
            } else {
                const updatePayload = isPublishedTest
                    ? {
                        title: testName.trim(),
                    }
                    : {
                        title: testName.trim(),
                        description: description.trim() || null,
                        durationMinutes: Number.parseInt(testDuration, 10) || 60,
                    };

                const updateResponse = await apiClient.patch(`/api/admin/tests/${currentTestId}`, updatePayload);

                if (!updateResponse.ok) {
                    throw new Error(updateResponse.message);
                }

                setSavedTitle(testName.trim());
                setSavedDuration(String(Number.parseInt(testDuration, 10) || 60));
            }

            let savedCount = 0;
            let failedCount = 0;
            const updatedQuestions = [...questions];

            for (let index = 0; index < updatedQuestions.length; index += 1) {
                const question = updatedQuestions[index];
                if (question.saved || !question.stem.trim()) continue;

                const payload = {
                    stem: question.stem.trim(),
                    sharedContext: question.sharedContext.trim() || undefined,
                    options: question.options.map((option) => ({
                        ...option,
                        text: option.text.trim(),
                    })),
                    difficulty: question.difficulty,
                    topic: question.topic.trim() || undefined,
                    explanation: question.explanation.trim() || undefined,
                };

                if (question.dbId) {
                    const updateQuestionResponse = await apiClient.patch<{ question: { id: string } }>(
                        `/api/admin/tests/${currentTestId}/questions/${question.dbId}`,
                        payload
                    );

                    if (updateQuestionResponse.ok) {
                        updatedQuestions[index].saved = true;
                        savedCount += 1;
                    } else {
                        failedCount += 1;
                    }
                } else {
                    const createQuestionResponse = await apiClient.post<{ question: { id: string } }>(
                        `/api/admin/tests/${currentTestId}/questions`,
                        payload
                    );

                    if (createQuestionResponse.ok && createQuestionResponse.data.question) {
                        updatedQuestions[index].dbId = createQuestionResponse.data.question.id;
                        updatedQuestions[index].saved = true;
                        savedCount += 1;
                    } else {
                        failedCount += 1;
                    }
                }
            }

            setQuestions(updatedQuestions);

            if (showSuccessToast) {
                if (isPublishedTest) {
                    toast.success("Title updated", {
                        description: "The published test name has been updated without changing question content.",
                    });
                } else if (failedCount > 0) {
                    toast.warning("Draft saved partially", {
                        description: `Test saved. ${savedCount} question(s) synced, ${failedCount} question(s) still need attention.`,
                    });
                } else {
                    toast.success("Draft saved", {
                        description: savedCount > 0
                            ? `${savedCount} question(s) synced successfully.`
                            : "All draft changes are up to date.",
                    });
                }
            }

            return currentTestId;
        } catch (error) {
            const message = error instanceof Error ? error.message : "Something went wrong while saving";
            toast.error("Save failed", { description: message });
            return null;
        } finally {
            setIsSavingDraft(false);
        }
    }, [description, isPublishedTest, questions, testDuration, testId, testName]);

    const assignSelectedBatches = useCallback(async (options?: AssignOptions) => {
        const showSuccessToast = options?.showSuccessToast ?? true;
        let currentTestId = options?.testOverrideId || testId;

        if (!currentTestId) {
            currentTestId = await saveDraft({ showSuccessToast: false });
        } else if (!isPublishedTest) {
            currentTestId = await saveDraft({ showSuccessToast: false });
        }

        if (!currentTestId) {
            return false;
        }

        if (selectedBatchIds.length === 0) {
            toast.error("Select at least one batch before assigning.");
            return false;
        }

        setIsAssigning(true);

        try {
            const response = await apiClient.post<{
                audience: BatchAudience;
                assigned: number;
                assignedBatches: AssignedBatch[];
            }>(`/api/admin/tests/${currentTestId}/assign`, {
                batchIds: selectedBatchIds,
            });

            if (!response.ok) {
                toast.error("Assignment failed", { description: response.message });
                return false;
            }

            setSavedAudience(response.data.audience);
            setSelectedBatchIds(response.data.assignedBatches.map((batch) => batch.id));

            if (showSuccessToast) {
                toast.success("Batches assigned", {
                    description: `${response.data.assigned} batch assignment(s) saved.`,
                });
            }

            return true;
        } finally {
            setIsAssigning(false);
        }
    }, [isPublishedTest, saveDraft, selectedBatchIds, testId]);

    const handleRepublishDuration = useCallback(async () => {
        if (!testId) {
            toast.error("Save the test before updating duration.");
            return;
        }

        const nextDuration = Number.parseInt(testDuration, 10) || 60;
        if (String(nextDuration) === savedDuration) {
            toast.error("No duration change detected.");
            return;
        }

        setIsPublishing(true);

        try {
            const response = await apiClient.patch<{ test: { durationMinutes: number } }>(`/api/admin/tests/${testId}`, {
                durationMinutes: nextDuration,
                status: "PUBLISHED",
            });

            if (!response.ok) {
                toast.error("Republish failed", { description: response.message });
                return;
            }

            const persistedDuration = String(response.data.test.durationMinutes);
            setTestDuration(persistedDuration);
            setSavedDuration(persistedDuration);
            toast.success("Published duration updated", {
                description: "The new duration will apply to future attempts. Sessions already in progress keep their current deadlines.",
            });
        } finally {
            setIsPublishing(false);
        }
    }, [savedDuration, testDuration, testId]);

    const handlePublish = async () => {
        if (isPublishedTest) {
            await handleRepublishDuration();
            return;
        }

        if (selectedBatchIds.length === 0) {
            toast.error("Assign the test to at least one batch before publishing.");
            return;
        }

        setIsPublishing(true);

        try {
            const savedId = await saveDraft({ showSuccessToast: false });
            if (!savedId) return;

            const assigned = await assignSelectedBatches({
                showSuccessToast: false,
                testOverrideId: savedId,
            });
            if (!assigned) return;

            const publishResponse = await apiClient.patch(`/api/admin/tests/${savedId}`, {
                status: "PUBLISHED",
            });

            if (!publishResponse.ok) {
                toast.error("Publish failed", { description: publishResponse.message });
                return;
            }

            setTestStatus("PUBLISHED");
            setIsContentLocked(true);
            setCanEditTitle(true);
            setCanEditDuration(true);
            setCanManageAssignments(true);
            setSavedTitle(testName.trim());
            setSavedDuration(String(Number.parseInt(testDuration, 10) || 60));
            toast.success("Test published", {
                description: "The test is now immediately available. Question content stays locked, while title, duration, and batch assignment remain adjustable for future attempts.",
            });
            router.replace(`/admin/tests/create?edit=${savedId}`);
        } finally {
            setIsPublishing(false);
        }
    };

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        if (event.target.files && event.target.files.length > 0) {
            setFile(event.target.files[0]);
        }
    };

    const handleImportJobSuccess = useCallback((payload: ImportJobResultPayload) => {
        const { test, questionsGenerated, failedCount, strategy, generationTarget, importDiagnostics } = payload;

        if (importDiagnostics?.reviewRequired) {
            toast.warning("Review recommended", {
                description:
                    importDiagnostics.warning ||
                    "This import completed, but verification found issues. Review the draft carefully before publishing.",
            });
        } else if (importDiagnostics?.aiFallbackUsed) {
            toast.warning("AI took the lead", {
                description:
                    importDiagnostics.warning ||
                    "The parser path struggled with this document, so AI fallback handled the extraction. Please inform engineering so the parser can be improved.",
            });
        }

        if (failedCount > 0) {
            toast.warning("Generated with warnings", {
                description: `${questionsGenerated} question(s) created, ${failedCount} failed validation.`,
            });
        } else if (strategy === "EXTRACTED") {
            toast.success("Question paper imported", {
                description: `${questionsGenerated} question(s) extracted directly from the document.`,
            });
        } else if (strategy === "AI_VISION_FALLBACK") {
            toast.success("AI fallback import complete", {
                description: `${questionsGenerated} question(s) prepared after the AI fallback took over from the parser path.`,
            });
        } else {
            toast.success("AI generation complete", {
                description: `${questionsGenerated} question(s) generated${generationTarget ? ` (target ${generationTarget})` : ""}.`,
            });
        }

        router.push(`/admin/tests/create?edit=${test.id}`);
    }, [router]);

    useEffect(() => {
        if (!importJob || (importJob.status !== "QUEUED" && importJob.status !== "PROCESSING")) {
            return;
        }

        let cancelled = false;

        const poll = async () => {
            const response = await apiClient.get<ImportJobResponse>(`/api/admin/tests/import-jobs/${importJob.id}`);
            if (cancelled) return;

            if (!response.ok) {
                setIsGenerating(false);
                setImportJob(null);
                toast.error("Import status failed", {
                    description: response.message,
                });
                return;
            }

            const nextJob = response.data.job;
            setImportJob(nextJob);

            if (nextJob.status === "SUCCEEDED") {
                setIsGenerating(false);
                setImportJob(null);
                setFile(null);

                if (!nextJob.result) {
                    toast.error("Generation failed", {
                        description: "The import completed without a result payload.",
                    });
                    return;
                }

                handleImportJobSuccess(nextJob.result);
                return;
            }

            if (nextJob.status === "FAILED") {
                setIsGenerating(false);
                setImportJob(null);
                toast.error("Generation failed", {
                    description:
                        nextJob.errorMessage
                        || nextJob.message
                        || "The import job failed in the background. Please try again.",
                });
            }
        };

        void poll();
        const intervalId = window.setInterval(() => {
            void poll();
        }, 2500);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [handleImportJobSuccess, importJob]);

    const handleAIGenerate = async () => {
        if (!file) {
            toast.error("Please upload a .docx or .pdf file first.");
            return;
        }

        const fileName = file.name.toLowerCase();
        if (!fileName.endsWith(".docx") && !fileName.endsWith(".pdf")) {
            toast.error("Invalid file type", {
                description: "Only .docx and .pdf files are supported.",
            });
            return;
        }

        setOpenAIModal(false);
        setIsGenerating(true);
        toast.info("Analyzing document", {
            description: "We will extract existing MCQs first and fall back to AI generation when needed. Large PDFs can take a couple of minutes.",
        });

        let jobQueued = false;
        try {
            const formData = new FormData();
            formData.append("file", file);
            formData.append("title", `AI Test - ${file.name.replace(/\.(docx|pdf)$/i, "")}`);

            const response = await fetch("/api/admin/tests/generate-from-doc", {
                method: "POST",
                body: formData,
            });
            const contentType = response.headers.get("content-type") || "";
            const data = contentType.includes("application/json")
                ? await response.json()
                : null;

            if (!response.ok) {
                if (response.status === 429) {
                    toast.error("Rate limit reached", {
                        description: data?.message || `Try again in ${data?.retryAfter ?? "a while"}.`,
                    });
                } else {
                    toast.error("Generation failed", {
                        description:
                            data?.message
                            || `The server returned ${response.status}. Please try again.`,
                    });
                }
                return;
            }

            if (!data) {
                throw new Error("Import endpoint returned a non-JSON success response.");
            }

            const payload = data as ImportJobResponse;
            setImportJob(payload.job);
            jobQueued = true;
            toast.success("Import queued", {
                description: "The document is being processed in the background. We’ll open the draft as soon as it is ready.",
            });
        } catch (error) {
            console.error("[AI][ADMIN] Document upload failed:", error);
            toast.error("Upload failed", {
                description: "Could not process the document. Please try again.",
            });
            setImportJob(null);
        } finally {
            if (!jobQueued) {
                setIsGenerating(false);
            }
        }
    };

    const importStageLabel = formatImportStage(importJob?.stage);
    const importElapsed = formatElapsedMs(importJob?.currentStageElapsedMs);
    const importMeta = [
        importJob?.lane ? `${importJob.lane.toLowerCase()} lane` : null,
        importJob?.selectedStrategy ? importJob.selectedStrategy.toLowerCase().replaceAll("_", " ") : null,
        importElapsed ? `${importElapsed} in stage` : null,
    ].filter(Boolean) as string[];

    if (isPageLoading) return <BuilderSkeleton />;

    return (
        <div className="flex w-full max-w-7xl flex-col gap-6 pb-10">
            {isContentLocked && (
                <div className="mx-auto mb-2 flex w-full max-w-6xl items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm text-amber-800">
                    <div className="mt-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
                    <div>
                        <h4 className="font-bold text-amber-900">This test is read-only</h4>
                        <p className="mt-1 text-sm font-medium opacity-90">
                            {testStatus === "PUBLISHED"
                                ? "Published tests keep their question content locked, but you can still rename the test, republish a new duration, and adjust batch assignment for future rollout details."
                                : "Archived tests stay visible for reference, but they cannot be edited."}
                        </p>
                    </div>
                </div>
            )}

            <div
                className="mx-auto flex w-full max-w-6xl flex-col gap-4 border-b pb-6 lg:flex-row lg:items-center lg:justify-between"
                style={{ borderColor: "var(--border-soft)" }}
            >
                <div>
                    <h1 className="flex items-center gap-3 text-3xl font-serif font-bold tracking-tight text-slate-900">
                        Admin Test Builder
                        <Badge
                            variant="outline"
                            className={`border-none px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                                testStatus === "PUBLISHED"
                                    ? "bg-emerald-50 text-emerald-700"
                                    : testStatus === "DRAFT"
                                        ? "bg-amber-50 text-amber-700"
                                        : "bg-slate-100 text-slate-600"
                            }`}
                        >
                            {testStatus}
                        </Badge>
                        <Badge
                            variant="outline"
                            className={`border-none px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${audienceBadgeClass(savedAudience)}`}
                        >
                            {audienceLabel(savedAudience)}
                        </Badge>
                    </h1>
                    <p className="mt-1 text-slate-500">
                        Build draft tests, assign batches, and publish them for immediate access.
                    </p>
                </div>
                <div className="flex w-full gap-3 sm:w-auto">
                    <Button
                        onClick={() => setOpenAIModal(true)}
                        disabled={isContentLocked || isBusy}
                        variant="outline"
                        className="h-11 flex-1 rounded-xl border-indigo-200 px-5 font-bold text-indigo-700 shadow-sm transition-all hover:bg-indigo-50 hover:text-indigo-800 sm:flex-none"
                    >
                        <Wand2 className="mr-2 h-4 w-4 text-indigo-500" />
                        Import via AI
                    </Button>
                </div>
            </div>

            {isGenerating && (
                <div className="mx-auto flex min-h-[400px] w-full max-w-6xl flex-col items-center justify-center overflow-hidden rounded-3xl bg-indigo-600 p-8 text-white shadow-clay-outer relative">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent opacity-10" />
                    <Loader2 className="relative z-10 mb-6 h-16 w-16 animate-spin text-indigo-200" />
                    <h2 className="relative z-10 text-2xl font-serif font-bold">Building your draft...</h2>
                    <p className="relative z-10 mt-2 font-medium text-indigo-200">
                        {importJob?.message || "Extracting questions and preparing an admin-owned draft test."}
                    </p>
                    <p className="relative z-10 mt-2 text-sm font-medium text-indigo-100/90">
                        {importStageLabel}
                        {importJob?.progressMessage ? ` · ${importJob.progressMessage}` : ""}
                    </p>
                    {importMeta.length > 0 && (
                        <p className="relative z-10 mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-100/80">
                            {importMeta.join(" · ")}
                        </p>
                    )}
                </div>
            )}

            {!isGenerating && (
                <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 lg:grid-cols-12">
                    <Card className="lg:col-span-3 flex h-[calc(100vh-220px)] flex-col overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-clay-outer">
                        <div
                            className="flex items-center justify-between border-b bg-surface px-5 py-5"
                            style={{ borderColor: "var(--border-soft)" }}
                        >
                            <h2 className="text-lg font-serif font-bold text-slate-800">Questions</h2>
                            <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                                {questions.length}
                            </span>
                        </div>
                        <div className="flex-1 overflow-auto bg-white">
                            <div className="flex flex-col">
                                {questions.map((question, index) => (
                                    <div
                                        key={index}
                                        onClick={() => setActiveQIndex(index)}
                                        className={`flex cursor-pointer items-start justify-between gap-2 border-b border-slate-100 border-l-4 p-4 transition-colors ${
                                            index === activeQIndex
                                                ? "border-l-indigo-600 bg-indigo-50"
                                                : "border-l-transparent hover:bg-slate-50"
                                        }`}
                                    >
                                        <p className={`flex-1 line-clamp-2 text-sm font-medium ${index === activeQIndex ? "text-slate-900" : "text-slate-600"}`}>
                                            Q{index + 1}. {question.stem || "(empty question)"}
                                        </p>
                                        <div className="flex shrink-0 items-center gap-1">
                                            {question.saved && <span className="h-2 w-2 rounded-full bg-emerald-500" title="Saved" />}
                                            {questions.length > 1 && (
                                                <button
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void removeQuestion(index);
                                                    }}
                                                    disabled={isContentLocked || isBusy}
                                                    className="p-0.5 text-slate-400 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                                                    title="Delete question"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="border-t bg-surface p-4" style={{ borderColor: "var(--border-soft)" }}>
                            <Button
                                variant="outline"
                                onClick={addQuestion}
                                disabled={isContentLocked || isBusy}
                                className="h-11 w-full rounded-xl border-slate-200 bg-white font-bold text-slate-700 shadow-sm hover:text-primary disabled:opacity-50"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Add Question
                            </Button>
                        </div>
                    </Card>

                    <Card className="lg:col-span-6 overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-clay-outer">
                        <div
                            className="flex items-center justify-between border-b bg-surface px-6 py-5"
                            style={{ borderColor: "var(--border-soft)" }}
                        >
                            <h2 className="text-lg font-serif font-bold text-slate-800">Question {activeQIndex + 1} Editor</h2>
                            {!activeQuestion.saved && activeQuestion.stem && (
                                <Badge className="border-0 bg-amber-100 text-[10px] text-amber-700">Unsaved</Badge>
                            )}
                        </div>
                        <CardContent className="flex flex-col gap-8 p-8">
                            <div className="space-y-3">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Question Stem</Label>
                                <Textarea
                                    placeholder="Enter the question prompt..."
                                    className="min-h-[120px] resize-none rounded-2xl border-transparent bg-surface-2 p-4 text-base font-medium text-slate-900 focus-visible:ring-indigo-500 disabled:opacity-60"
                                    value={activeQuestion.stem}
                                    onChange={(event) => updateActiveQuestion({ stem: event.target.value })}
                                    disabled={isContentLocked || isBusy}
                                />
                            </div>

                            <div className="space-y-3">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                                    Shared Reference / Table
                                </Label>
                                <Textarea
                                    placeholder="Paste or review any shared table, chart, passage, or data block needed for this question."
                                    className="min-h-[140px] resize-none rounded-2xl border-transparent bg-surface-2 p-4 text-sm font-medium text-slate-900 focus-visible:ring-indigo-500 disabled:opacity-60"
                                    value={activeQuestion.sharedContext}
                                    onChange={(event) => updateActiveQuestion({ sharedContext: event.target.value })}
                                    disabled={isContentLocked || isBusy}
                                />
                                <p className="text-xs font-medium text-slate-500">
                                    Use this for data-interpretation tables, passages, or any shared prompt block that students must see before answering.
                                </p>
                                {activeQuestion.sharedContext.trim() || activeQuestion.references?.length ? (
                                    <div className="space-y-3">
                                        <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                                            Structured Preview
                                        </Label>
                                        <SharedContextRenderer
                                            context={activeQuestion.sharedContext}
                                            references={activeQuestion.references}
                                            title="Preview"
                                            tone="slate"
                                        />
                                    </div>
                                ) : null}
                            </div>

                            <div className="space-y-4">
                                <Label className="mb-2 block border-t border-slate-100 pt-6 text-[11px] font-bold uppercase tracking-wider text-slate-700">
                                    Answer Options
                                </Label>
                                {activeQuestion.options.map((option, optionIndex) => (
                                    <Input
                                        key={option.id}
                                        placeholder={`Option ${option.id}`}
                                        value={option.text}
                                        onChange={(event) => handleOptionTextChange(optionIndex, event.target.value)}
                                        disabled={isContentLocked || isBusy}
                                        className="h-12 rounded-xl border-transparent bg-surface-2 px-4 font-medium text-slate-900 focus-visible:ring-indigo-500 disabled:opacity-60"
                                    />
                                ))}
                            </div>

                            <div className="space-y-4 border-t border-slate-100 pt-6">
                                <Label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-700">
                                    <span>Select correct answer</span>
                                    {!activeQuestion.options.some((option) => option.isCorrect) && (
                                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] text-rose-500">Required</span>
                                    )}
                                </Label>
                                <RadioGroup
                                    disabled={isContentLocked || isBusy}
                                    value={activeQuestion.options.find((option) => option.isCorrect)?.id || "A"}
                                    onValueChange={handleCorrectAnswerChange}
                                    className="grid grid-cols-2 gap-4"
                                >
                                    {activeQuestion.options.map((option) => (
                                        <Label
                                            key={option.id}
                                            htmlFor={`correct-${option.id}`}
                                            className={`flex cursor-pointer items-center space-x-3 rounded-xl border p-4 shadow-sm transition-colors focus-within:ring-2 ring-indigo-500 ${
                                                option.isCorrect
                                                    ? "border-indigo-300 bg-indigo-50"
                                                    : "border-slate-200/60 bg-white hover:border-indigo-200 hover:bg-indigo-50/50"
                                            } ${isContentLocked || isBusy ? "cursor-not-allowed opacity-60" : ""}`}
                                        >
                                            <RadioGroupItem value={option.id} id={`correct-${option.id}`} disabled={isContentLocked || isBusy} />
                                            <span className="flex-1 font-bold text-slate-700">
                                                Option {option.id} {option.isCorrect ? "✓" : ""}
                                            </span>
                                        </Label>
                                    ))}
                                </RadioGroup>
                            </div>

                            <div className="grid grid-cols-2 gap-6 border-t border-slate-100 pt-6">
                                <div className="space-y-3">
                                    <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Topic</Label>
                                    <Input
                                        disabled={isContentLocked || isBusy}
                                        value={activeQuestion.topic}
                                        onChange={(event) => updateActiveQuestion({ topic: event.target.value })}
                                        placeholder="e.g. Thermodynamics"
                                        className="h-12 rounded-xl border-transparent bg-surface-2 px-4 font-bold text-slate-900 disabled:opacity-60"
                                    />
                                </div>
                                <div className="space-y-3">
                                    <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Difficulty</Label>
                                    <Select
                                        disabled={isContentLocked || isBusy}
                                        value={activeQuestion.difficulty}
                                        onValueChange={(value) => updateActiveQuestion({ difficulty: value as Question["difficulty"] })}
                                    >
                                        <SelectTrigger className="h-12 rounded-xl border-transparent bg-surface-2 px-4 font-bold text-slate-800 disabled:opacity-60">
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

                    <Card className="lg:col-span-3 flex flex-col overflow-hidden rounded-3xl border-0 bg-white p-0 shadow-clay-outer">
                        <div
                            className="border-b bg-surface px-6 py-5"
                            style={{ borderColor: "var(--border-soft)" }}
                        >
                            <h2 className="text-lg font-serif font-bold text-slate-800">Draft Settings</h2>
                        </div>
                        <CardContent className="flex flex-1 flex-col gap-6 p-6">
                            <div className="space-y-3">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Test Name</Label>
                                <Input
                                    disabled={!canEditTitle || isBusy}
                                    value={testName}
                                    onChange={(event) => setTestName(event.target.value)}
                                    placeholder="e.g. CUET Physics Mock 3"
                                    className="h-12 rounded-xl border-transparent bg-surface-2 px-4 font-bold text-slate-900 disabled:opacity-60"
                                />
                            </div>
                            <div className="space-y-3">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Description</Label>
                                <Textarea
                                    disabled={isContentLocked || isBusy}
                                    className="h-24 resize-none rounded-xl border-transparent bg-surface-2 p-4 font-medium text-slate-800 disabled:opacity-60"
                                    value={description}
                                    onChange={(event) => setDescription(event.target.value)}
                                    placeholder="Add instructions or context..."
                                />
                            </div>
                            <div className="space-y-3 border-t border-slate-100 pt-4">
                                <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Duration</Label>
                                <Input
                                    disabled={!canEditDuration || isBusy}
                                    type="number"
                                    value={testDuration}
                                    onChange={(event) => setTestDuration(event.target.value)}
                                    min={5}
                                    max={300}
                                    className="h-12 rounded-xl border-transparent bg-surface-2 px-4 font-bold text-slate-900 disabled:opacity-60"
                                />
                            </div>
                            <div className="space-y-4 border-t border-slate-100 pt-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-serif font-bold text-slate-800">Assign to Batches</h3>
                                    <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                                        {selectedBatchIds.length} selected
                                    </Badge>
                                </div>
                                {availableBatches.length === 0 ? (
                                    <p className="text-sm italic text-slate-500">No batches available yet.</p>
                                ) : (
                                    <div className="max-h-56 space-y-2 overflow-y-auto pr-2">
                                        {availableBatches.map((batch) => (
                                            <div
                                                key={batch.id}
                                                className={`flex items-center space-x-3 rounded-xl border border-slate-100 p-3 transition-colors ${
                                                    !canManageAssignments || isBusy ? "opacity-60" : "hover:bg-slate-50"
                                                }`}
                                            >
                                                <Checkbox
                                                    id={`admin-batch-${batch.id}`}
                                                    checked={selectedBatchIds.includes(batch.id)}
                                                    disabled={!canManageAssignments || isBusy}
                                                    onCheckedChange={(checked) => {
                                                        if (checked) {
                                                            setSelectedBatchIds((current) => [...current, batch.id]);
                                                        } else {
                                                            setSelectedBatchIds((current) => current.filter((id) => id !== batch.id));
                                                        }
                                                    }}
                                                />
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <Label
                                                            htmlFor={`admin-batch-${batch.id}`}
                                                            className={`block font-bold text-slate-800 ${!canManageAssignments || isBusy ? "" : "cursor-pointer"}`}
                                                        >
                                                            {batch.name}
                                                        </Label>
                                                        <Badge
                                                            variant="outline"
                                                            className={`border-none px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                                                batch.kind === "FREE_SYSTEM"
                                                                    ? "bg-sky-50 text-sky-700"
                                                                    : "bg-violet-50 text-violet-700"
                                                            }`}
                                                        >
                                                            {batch.kind === "FREE_SYSTEM" ? "Free" : "Paid"}
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-0.5 text-xs text-slate-400">{batch.code}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">
                                    Assignments determine who can access the test. Selecting FREE-Batch makes it public, and you can combine it with paid batches when the same mock should be available to both audiences.
                                </div>
                            </div>
                        </CardContent>
                        <div className="flex flex-col gap-3 border-t bg-surface p-6" style={{ borderColor: "var(--border-soft)" }}>
                            <Button
                                onClick={() => void saveDraft()}
                                disabled={
                                    isBusy ||
                                    (!isPublishedTest && isContentLocked) ||
                                    (isPublishedTest && !hasPublishedTitleChange)
                                }
                                variant="outline"
                                className="h-12 w-full rounded-xl border-slate-200 text-base font-bold shadow-sm disabled:opacity-60"
                            >
                                <Save className="mr-2 h-4 w-4" />
                                {isSavingDraft
                                    ? "Saving..."
                                    : isPublishedTest
                                        ? "Save Title"
                                        : "Save Draft"}
                            </Button>
                            <Button
                                onClick={() => void assignSelectedBatches()}
                                disabled={!canManageAssignments || isBusy}
                                variant="outline"
                                className="h-12 w-full rounded-xl border-slate-200 text-base font-bold shadow-sm disabled:opacity-60"
                            >
                                <Layers3 className="mr-2 h-4 w-4" />
                                {isAssigning ? "Assigning..." : "Assign To Batches"}
                            </Button>
                            <Button
                                onClick={handlePublish}
                                disabled={testStatus === "ARCHIVED" || isBusy || (isPublishedTest && !hasPublishedDurationChange)}
                                className="h-12 w-full rounded-xl bg-indigo-600 text-base font-bold shadow-clay-inner hover:bg-indigo-700 disabled:opacity-60"
                            >
                                <Send className="mr-2 h-4 w-4" />
                                {isPublishing
                                    ? (isPublishedTest ? "Republishing..." : "Publishing...")
                                    : (isPublishedTest ? "Republish Duration" : "Publish")}
                            </Button>
                        </div>
                    </Card>
                </div>
            )}

            <Dialog open={openAIModal} onOpenChange={setOpenAIModal}>
                <DialogContent className="overflow-hidden rounded-3xl border-0 p-0 shadow-clay-outer sm:max-w-md">
                    <div className="bg-indigo-600 p-8 text-center relative overflow-hidden">
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent opacity-10" />
                        <Wand2 className="relative z-10 mx-auto mb-4 h-12 w-12 text-indigo-200" />
                        <DialogTitle className="relative z-10 text-2xl font-serif text-white">AI Test Generator</DialogTitle>
                        <DialogDescription className="relative z-10 mt-2 text-center font-medium text-indigo-100">
                            Upload a document and generate a draft test directly in the admin workspace.
                        </DialogDescription>
                    </div>
                    <div className="space-y-6 bg-surface p-8 pb-10">
                        <div className="relative cursor-pointer rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-8 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50">
                            <UploadCloud className="mx-auto mb-3 h-10 w-10 text-indigo-400" />
                            <p className="text-sm font-bold text-slate-700">Click to upload or drag and drop</p>
                            <p className="mt-1 text-xs font-medium text-slate-500">.docx or .pdf (Max 5MB)</p>
                            <input type="file" className="hidden" id="admin-file-upload" accept=".docx,.pdf" onChange={handleFileChange} />
                            <label htmlFor="admin-file-upload" className="absolute inset-0 cursor-pointer"></label>
                        </div>
                        {file && (
                            <div className="flex items-start rounded-xl border border-emerald-100 bg-white p-3 text-sm font-bold text-emerald-700 shadow-sm">
                                <div className="mr-3 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">✓</div>
                                <div className="min-w-0">
                                    <p
                                        className="break-all text-sm font-bold text-emerald-700"
                                        title={file.name}
                                    >
                                        {file.name}
                                    </p>
                                    <p className="mt-1 text-xs font-medium text-emerald-600/80">
                                        Ready for import
                                    </p>
                                </div>
                            </div>
                        )}
                        <div className="rounded-2xl border border-indigo-100 bg-white px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
                            Duration and batch assignment stay on the builder after the questions are imported, and published tests can republish a new duration for future attempts.
                        </div>
                        <Button
                            onClick={handleAIGenerate}
                            disabled={!file}
                            className="h-12 w-full rounded-xl bg-indigo-600 font-bold text-white shadow-clay-inner hover:bg-indigo-700"
                        >
                            Generate Questions
                            <Wand2 className="ml-2 h-4 w-4" />
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default function AdminTestBuilderPage() {
    return (
        <Suspense fallback={<BuilderSkeleton />}>
            <AdminTestBuilderForm />
        </Suspense>
    );
}
