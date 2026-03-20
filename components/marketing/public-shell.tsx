import Link from 'next/link'
import { ArrowRight, LogIn, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PublicShellProps = {
    children: React.ReactNode
    className?: string
}

export function PublicShell({ children, className }: PublicShellProps) {
    return (
        <div className={cn('min-h-screen bg-[#f7efe3] text-slate-900', className)}>
            <div className="absolute inset-x-0 top-0 -z-10 overflow-hidden">
                <div className="mx-auto h-[420px] w-[900px] rounded-full bg-[radial-gradient(circle_at_center,rgba(22,163,74,0.14),rgba(247,239,227,0)_66%)]" />
            </div>
            <header className="sticky top-0 z-40 border-b border-slate-900/5 bg-[#f7efe3]/90 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4 sm:px-6 lg:px-8">
                    <Link href="/" className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-[0_20px_40px_rgba(15,23,42,0.18)]">
                            <Sparkles className="h-5 w-5" />
                        </div>
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.34em] text-emerald-700">
                                UNIMONKS
                            </div>
                            <div className="font-serif text-xl font-bold tracking-tight text-slate-900">
                                CUET Coaching
                            </div>
                        </div>
                    </Link>

                    <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
                        <Link href="/free-mocks" className="transition-colors hover:text-slate-900">
                            Free Mocks
                        </Link>
                        <Link href="/#why" className="transition-colors hover:text-slate-900">
                            Why UNIMONKS
                        </Link>
                        <Link href="/#faq" className="transition-colors hover:text-slate-900">
                            FAQ
                        </Link>
                    </nav>

                    <div className="flex items-center gap-3">
                        <Button
                            asChild
                            variant="ghost"
                            className="hidden rounded-2xl px-4 text-slate-700 hover:bg-white/70 sm:inline-flex"
                        >
                            <Link href="/free-mocks">
                                Explore Free Mocks
                                <ArrowRight className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                        <Button asChild className="rounded-2xl bg-slate-900 px-5 text-white hover:bg-slate-800">
                            <Link href="/login">
                                Login
                                <LogIn className="ml-2 h-4 w-4" />
                            </Link>
                        </Button>
                    </div>
                </div>
            </header>

            <main>{children}</main>

            <footer className="border-t border-slate-900/5 bg-white/70">
                <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
                    <div className="space-y-2">
                        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
                            UNIMONKS CUET Coaching
                        </p>
                        <p className="max-w-2xl text-sm leading-6 text-slate-600">
                            Take a public mock, get an instant score summary, and move into the paid batch experience when you are ready.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Button asChild variant="ghost" className="rounded-2xl">
                            <Link href="/free-mocks">Free Mock Catalog</Link>
                        </Button>
                        <Button asChild variant="ghost" className="rounded-2xl">
                            <Link href="/#contact">Enrollment Guidance</Link>
                        </Button>
                        <Button asChild className="rounded-2xl bg-slate-900 text-white hover:bg-slate-800">
                            <Link href="/login">Student Login</Link>
                        </Button>
                    </div>
                </div>
            </footer>
        </div>
    )
}
