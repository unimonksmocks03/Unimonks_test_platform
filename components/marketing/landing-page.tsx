import Link from 'next/link'
import {
    ArrowRight,
    BadgeCheck,
    CircleHelp,
    Globe,
    GraduationCap,
    Lock,
    Mail,
    MapPin,
    Phone,
    Radar,
    ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { UnimonksBrand } from '@/components/branding/unimonks-brand'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PLATFORM_POLICY } from '@/lib/config/platform-policy'
import { UNIMONKS_BRAND, UNIMONKS_CONTACT } from '@/lib/config/unimonks'
import type { PublicMockCatalog } from '@/lib/services/free-test-service'
import { cn } from '@/lib/utils'

import { PublicShell } from './public-shell'
import { TestCard } from './test-card'

export const landingFaqItems = [
    {
        question: 'Do I need a login for the free mocks?',
        answer: 'No. Free mocks are public. You submit your name, email, and phone first, and the attempt is stored against your lead record instead of an application account.',
    },
    {
        question: 'How many times can I attempt a free mock?',
        answer: `Each lead gets exactly ${PLATFORM_POLICY.maxFreeTotalAttempts} total attempt per free mock.`,
    },
    {
        question: 'What happens if I am already an enrolled student?',
        answer: 'Use the login button. Registered students should stay in the OTP login flow and use the assigned paid tests inside their dashboard.',
    },
    {
        question: 'What are the locked premium mocks?',
        answer: 'They represent the paid batch experience. Those mocks stay reserved for enrolled students and do not unlock through the free public flow.',
    },
]

const fallbackPremiumCards = [
    {
        id: 'premium-language',
        title: 'Premium CUET Language Sprint',
        description: 'Reserved for enrolled students who need timed sectional drills and batch-level performance tracking.',
        durationMinutes: 45,
        questionCount: 40,
    },
    {
        id: 'premium-domain',
        title: 'Premium Domain Mastery Drill',
        description: 'Long-form premium drill sets with stronger diagnostics, reattempt depth, and batch benchmarking.',
        durationMinutes: 60,
        questionCount: 50,
    },
    {
        id: 'premium-grand',
        title: 'Premium Grand Mock Sequence',
        description: 'A full exam simulation lane for students inside their assigned batch workflow.',
        durationMinutes: 90,
        questionCount: 70,
    },
]

type LandingContactItem = {
    label: string
    value: string
    href: string
    helper: string
    icon: LucideIcon
    external?: boolean
    className?: string
}

const landingContactItems: LandingContactItem[] = [
    {
        label: 'Call or WhatsApp',
        value: UNIMONKS_CONTACT.phoneDisplay,
        href: UNIMONKS_CONTACT.phoneHref,
        helper: 'Talk to the UNIMONKS team for admissions, batch guidance, and paid mock access.',
        icon: Phone,
    },
    {
        label: 'Email',
        value: UNIMONKS_CONTACT.email,
        href: UNIMONKS_CONTACT.emailHref,
        helper: 'Share questions about mock tests, coaching plans, or enrollment.',
        icon: Mail,
    },
    {
        label: 'Website',
        value: UNIMONKS_CONTACT.websiteLabel,
        href: UNIMONKS_CONTACT.websiteUrl,
        helper: 'Browse the wider coaching site and current course information.',
        icon: Globe,
        external: true,
    },
    {
        label: 'Visit the center',
        value: UNIMONKS_CONTACT.addressDisplay,
        href: UNIMONKS_CONTACT.mapUrl,
        helper: UNIMONKS_CONTACT.locationLabel,
        icon: MapPin,
        external: true,
        className: 'sm:col-span-2',
    },
]

type LandingPageProps = {
    catalog: PublicMockCatalog
}

export function LandingPage({ catalog }: LandingPageProps) {
    const freePreview = catalog.freeTests.slice(0, 3)
    const premiumPreview = (catalog.premiumTests.length > 0 ? catalog.premiumTests : fallbackPremiumCards).slice(0, 3)

    return (
        <PublicShell>
            <section className="mx-auto grid max-w-7xl gap-10 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:px-8 lg:pt-16">
                <div className="space-y-8">
                    <Badge className="rounded-full border-0 bg-emerald-100 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-800">
                        CUET prep with public entry
                    </Badge>
                    <div className="space-y-5">
                        <h1 className="max-w-4xl font-serif text-5xl font-bold tracking-tight text-slate-950 sm:text-6xl">
                            Public CUET mocks in front. Premium batch practice behind the lock.
                        </h1>
                        <p className="max-w-2xl text-lg leading-8 text-slate-600">
                            {UNIMONKS_BRAND.shortName} gives every serious CUET aspirant a clean public starting point:
                            take a free mock, get a result immediately, and move into the paid batch system when you want
                            the full program.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-4">
                        <Button asChild className="h-13 rounded-2xl bg-slate-900 px-6 text-base font-semibold text-white hover:bg-slate-800">
                            <Link href="/free-mocks">
                                Explore Free Mocks
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Link>
                        </Button>
                        <Button asChild variant="ghost" className="h-13 rounded-2xl bg-white/80 px-6 text-base font-semibold text-slate-800 hover:bg-white">
                            <Link href="/#contact">Enrollment Guidance</Link>
                        </Button>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                        {[
                            {
                                label: 'Free attempts',
                                value: `${PLATFORM_POLICY.maxFreeTotalAttempts} per mock`,
                                icon: ShieldCheck,
                            },
                            {
                                label: 'Public catalog',
                                value: `${catalog.freeTests.length} live mocks`,
                                icon: Radar,
                            },
                            {
                                label: 'Premium lane',
                                value: 'Batch-assigned only',
                                icon: Lock,
                            },
                        ].map((item) => (
                            <Card key={item.label} className="border-0 bg-white/85">
                                <CardContent className="space-y-3 p-6">
                                    <item.icon className="h-5 w-5 text-emerald-700" />
                                    <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                                        {item.label}
                                    </div>
                                    <div className="font-serif text-2xl font-bold text-slate-950">
                                        {item.value}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>
                </div>

                <div className="relative">
                    <div className="absolute -left-10 top-10 hidden h-40 w-40 rounded-full bg-emerald-200/60 blur-3xl lg:block" />
                    <Card className="relative overflow-hidden border-0 bg-[linear-gradient(180deg,#0f172a_0%,#172554_100%)] text-white">
                        <CardContent className="space-y-8 p-8">
                            <div className="space-y-4">
                                <Badge className="rounded-full border-0 bg-white/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
                                    Public to premium
                                </Badge>
                                <h2 className="font-serif text-3xl font-bold">
                                    Start publicly. Upgrade only when you want the full batch stack.
                                </h2>
                                <p className="text-sm leading-7 text-white/78">
                                    Free users stay outside the login system. Enrolled students use the same OTP login and
                                    continue into paid mocks, analytics, and batch-level progression.
                                </p>
                            </div>

                            <div className="space-y-4 rounded-[28px] bg-white/8 p-5">
                                {[
                                    'Lead capture before every public attempt',
                                    'One free attempt per lead per free mock',
                                    'Premium mocks stay visible but locked',
                                ].map((line) => (
                                    <div key={line} className="flex items-start gap-3 text-sm text-white/86">
                                        <BadgeCheck className="mt-0.5 h-4 w-4 text-emerald-300" />
                                        <span>{line}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="rounded-[28px] bg-white px-5 py-4 text-slate-900">
                                <div className="flex items-center gap-3">
                                    <GraduationCap className="h-9 w-9 rounded-2xl bg-emerald-100 p-2 text-emerald-700" />
                                    <div>
                                        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                                            For enrolled students
                                        </div>
                                        <div className="font-serif text-xl font-bold">Use Login on the top-right</div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </section>

            <section id="free-mocks" className="mx-auto max-w-7xl px-4 py-18 sm:px-6 lg:px-8">
                <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-3">
                        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                            Free mock catalog
                        </p>
                        <h2 className="font-serif text-4xl font-bold text-slate-950">
                            Pick a live public mock and start with a single clean attempt.
                        </h2>
                        <p className="max-w-3xl text-base leading-7 text-slate-600">
                            These are the tests assigned to the public free lane. You share your contact details once,
                            attempt the mock, and get a result page immediately after submission.
                        </p>
                    </div>
                    <Button asChild variant="ghost" className="rounded-2xl bg-white px-5 py-6 text-base font-semibold text-slate-900 hover:bg-white">
                        <Link href="/free-mocks">
                            See Full Catalog
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </div>

                {freePreview.length > 0 ? (
                    <div className="grid gap-6 lg:grid-cols-3">
                        {freePreview.map((test) => (
                            <TestCard
                                key={test.id}
                                test={test}
                                variant="free"
                                href={`/free-mocks/${test.id}`}
                            />
                        ))}
                    </div>
                ) : (
                    <Card className="border-0 bg-white">
                        <CardContent className="space-y-4 p-8">
                            <div className="text-sm font-semibold uppercase tracking-[0.22em] text-slate-500">
                                Fresh mocks publishing soon
                            </div>
                            <h3 className="font-serif text-3xl font-bold text-slate-950">
                                The public catalog is being refreshed.
                            </h3>
                            <p className="max-w-2xl text-base leading-7 text-slate-600">
                                The free lane is part of the product now. If no mocks are live at this moment, check back
                                shortly or use the login button if you are already enrolled.
                            </p>
                        </CardContent>
                    </Card>
                )}
            </section>

            <section id="premium" className="bg-[#10303a] py-18 text-white">
                <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                    <div className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div className="space-y-3">
                            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-200">
                                Locked premium section
                            </p>
                            <h2 className="font-serif text-4xl font-bold text-white">
                                The premium practice lane stays visible, but it only opens after enrollment.
                            </h2>
                            <p className="max-w-3xl text-base leading-7 text-white/74">
                                Premium mocks sit behind the batch system. You can inspect the lane publicly, but the
                                attempt flow is intentionally locked until you enroll.
                            </p>
                        </div>
                        <Button asChild className="rounded-2xl bg-white text-slate-950 hover:bg-white/90">
                            <Link href="/#contact">Talk to {UNIMONKS_BRAND.shortName}</Link>
                        </Button>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-3">
                        {premiumPreview.map((test) => (
                            <TestCard
                                key={test.id}
                                test={test}
                                variant="premium"
                                ctaHref="/#contact"
                            />
                        ))}
                    </div>
                </div>
            </section>

            <section id="why" className="mx-auto max-w-7xl px-4 py-18 sm:px-6 lg:px-8">
                <div className="mb-10 space-y-3">
                    <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                        Why {UNIMONKS_BRAND.shortName}
                    </p>
                    <h2 className="font-serif text-4xl font-bold text-slate-950">
                        Built for a cleaner public funnel and a sharper paid experience.
                    </h2>
                </div>

                <div className="grid gap-6 lg:grid-cols-3">
                    {[
                        {
                            title: 'Public entry without account friction',
                            description: 'Free users never become application users. They stay in a lead-only funnel until they decide to enroll.',
                            icon: Radar,
                        },
                        {
                            title: 'Server-backed timed attempts',
                            description: 'Every free mock still runs against a server deadline, so the timer and submission flow stay authoritative.',
                            icon: ShieldCheck,
                        },
                        {
                            title: 'Clear upgrade path',
                            description: 'Premium mocks remain visible enough to sell the value, but the attempt flow stays reserved for enrolled students.',
                            icon: Lock,
                        },
                    ].map((item) => (
                        <Card key={item.title} className="border-0 bg-white">
                            <CardContent className="space-y-5 p-7">
                                <item.icon className="h-8 w-8 text-emerald-700" />
                                <div className="space-y-3">
                                    <h3 className="font-serif text-2xl font-bold text-slate-950">{item.title}</h3>
                                    <p className="text-base leading-7 text-slate-600">{item.description}</p>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            </section>

            <section id="contact" className="mx-auto max-w-7xl px-4 pb-18 sm:px-6 lg:px-8">
                <Card className="overflow-hidden border-0 bg-[linear-gradient(135deg,#1f2937_0%,#0f766e_100%)] text-white">
                    <CardContent className="grid gap-10 p-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:p-10">
                        <div className="space-y-6">
                            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-200">
                                Contact {UNIMONKS_BRAND.shortName}
                            </p>
                            <h2 className="font-serif text-4xl font-bold">
                                Take a free mock now, then talk to the team when you want the full CUET program.
                            </h2>
                            <p className="max-w-2xl text-base leading-7 text-white/78">
                                The public lane stays open for first-time practice. When you want batch guidance,
                                classroom support, or the paid mock stack, use any of the verified UNIMONKS contact
                                routes below.
                            </p>

                            <div className="grid gap-4 sm:grid-cols-2">
                                {landingContactItems.map((item) => (
                                    <a
                                        key={item.label}
                                        href={item.href}
                                        target={item.external ? '_blank' : undefined}
                                        rel={item.external ? 'noreferrer' : undefined}
                                        className={cn(
                                            'rounded-[28px] border border-white/12 bg-white/10 p-5 transition-transform hover:-translate-y-0.5 hover:bg-white/14',
                                            item.className,
                                        )}
                                    >
                                        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-white/12">
                                            <item.icon className="h-5 w-5 text-emerald-200" />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/90">
                                                {item.label}
                                            </div>
                                            <div className="break-words text-base font-semibold text-white">
                                                {item.value}
                                            </div>
                                            <p className="text-sm leading-6 text-white/70">{item.helper}</p>
                                        </div>
                                    </a>
                                ))}
                            </div>
                        </div>

                        <div className="space-y-4 rounded-[28px] bg-white/10 p-6">
                            <UnimonksBrand
                                className="gap-3"
                                imageClassName="h-16 w-auto max-w-full"
                                titleClassName="text-[1.65rem]"
                                cuetClassName="text-[1.65rem]"
                                underlineClassName="mt-1 h-[3px] w-[96%]"
                                variant="inverse"
                            />
                            <div className="flex items-start gap-3 text-sm leading-6 text-white/86">
                                <CircleHelp className="mt-0.5 h-5 w-5 text-amber-300" />
                                <span>
                                    Free mocks do not require a login. Admin and enrolled students should use the OTP
                                    login button in the top-right.
                                </span>
                            </div>
                            <Button asChild className="h-12 w-full rounded-2xl bg-white text-slate-950 hover:bg-white/90">
                                <Link href="/free-mocks">Start a Free Mock</Link>
                            </Button>
                            <Button asChild variant="ghost" className="h-12 w-full rounded-2xl border border-white/20 bg-transparent text-white hover:bg-white/10">
                                <Link href="/login">Already enrolled? Login</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </section>

            <section id="faq" className="mx-auto max-w-4xl px-4 pb-24 sm:px-6 lg:px-8">
                <div className="mb-8 space-y-3 text-center">
                    <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                        FAQ
                    </p>
                    <h2 className="font-serif text-4xl font-bold text-slate-950">
                        Questions students usually ask before the first mock.
                    </h2>
                </div>
                <Card className="border-0 bg-white">
                    <CardContent className="p-6">
                        <Accordion type="single" collapsible>
                            {landingFaqItems.map((item) => (
                                <AccordionItem key={item.question} value={item.question} className="border-slate-200">
                                    <AccordionTrigger className="text-base font-semibold text-slate-900 hover:no-underline">
                                        {item.question}
                                    </AccordionTrigger>
                                    <AccordionContent className="text-sm leading-7 text-slate-600">
                                        {item.answer}
                                    </AccordionContent>
                                </AccordionItem>
                            ))}
                        </Accordion>
                    </CardContent>
                </Card>
            </section>
        </PublicShell>
    )
}
