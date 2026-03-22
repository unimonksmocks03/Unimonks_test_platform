import Image from 'next/image'
import { Anton } from 'next/font/google'

import { UNIMONKS_BRAND } from '@/lib/config/unimonks'
import { cn } from '@/lib/utils'

const anton = Anton({
    subsets: ['latin'],
    weight: '400',
    display: 'swap',
})

type UnimonksBrandProps = {
    className?: string
    imageClassName?: string
    titleClassName?: string
    cuetClassName?: string
    underlineClassName?: string
    wordmarkClassName?: string
    priority?: boolean
    showWordmark?: boolean
    variant?: 'default' | 'inverse'
}

export function UnimonksBrand({
    className,
    imageClassName,
    titleClassName,
    cuetClassName,
    underlineClassName,
    wordmarkClassName,
    priority = false,
    showWordmark = true,
    variant = 'default',
}: UnimonksBrandProps) {
    return (
        <div className={cn('flex items-center gap-3', className)}>
            <Image
                src={UNIMONKS_BRAND.logoPath}
                alt={UNIMONKS_BRAND.logoAlt}
                width={549}
                height={439}
                priority={priority}
                className={cn('h-12 w-auto shrink-0 object-contain', imageClassName)}
            />
            {showWordmark ? (
                <div className={cn('min-w-0', wordmarkClassName)}>
                    <div className="flex items-end gap-2 whitespace-nowrap leading-none">
                        <span
                            className={cn(
                                anton.className,
                                'text-3xl uppercase tracking-[-0.04em]',
                                titleClassName,
                            )}
                        >
                            <span className="text-[#EE508D]">UNI</span>
                            <span className="text-[#546FFF]">MONKS</span>
                        </span>
                        <span
                            className={cn(
                                anton.className,
                                'text-3xl uppercase tracking-[-0.04em]',
                                variant === 'inverse' ? 'text-white' : 'text-slate-950',
                                cuetClassName,
                            )}
                        >
                            CUET
                        </span>
                    </div>
                    <div
                        className={cn(
                            'mt-1.5 h-1 w-[92%] rounded-full bg-[linear-gradient(90deg,#ff2d2d_0%,#ff2d2d_70%,#3f5fff_100%)] shadow-[0_0_14px_rgba(255,45,45,0.2)]',
                            underlineClassName,
                        )}
                    />
                </div>
            ) : null}
        </div>
    )
}
