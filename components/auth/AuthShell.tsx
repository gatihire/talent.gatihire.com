import type { PropsWithChildren } from "react"
import { BRAND_LOGO_URL, BRAND_NAME } from "@/lib/branding"
import Link from "next/link"

export function AuthShell({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle: string }>) {
  return (
    <div className="h-screen w-full flex overflow-hidden bg-white dark:bg-zinc-950 transition-colors duration-300">
      {/* Left side: Content */}
      <div className="flex-1 flex flex-col px-6 py-10 lg:px-20 lg:py-16 relative overflow-y-auto lg:overflow-hidden">
        {/* Logo at top left */}
        <div className="mb-8 lg:mb-12">
          <Link href="/jobs" className="inline-block">
            <img 
              src={BRAND_LOGO_URL} 
              alt={BRAND_NAME} 
              className="h-8 w-auto object-contain brightness-0 dark:invert transition-all duration-300" 
            />
          </Link>
        </div>

        {/* Center content */}
        <div className="flex-1 flex flex-col justify-center">
          <div className="w-full max-w-[400px] mx-auto">
            <div className="mb-10">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</h1>
              <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            </div>
            
            <div className="space-y-6">
              {children}
            </div>
          </div>
        </div>
        
        {/* Footer for mobile/bottom */}
        <div className="mt-10 text-[10px] uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
          © {new Date().getFullYear()} {BRAND_NAME}. Built for Logistics.
        </div>
      </div>

      {/* Right side: Image with quote */}
      <div className="hidden lg:flex flex-1 p-4 relative">
        <div className="w-full h-full relative overflow-hidden rounded-[2.5rem] shadow-2xl">
          <img 
            src="https://i.postimg.cc/VvGJcvqz/Chat-GPT-Image-Mar-8-2026-01-19-05-PM.png"
            alt="Logistics background"
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/20 to-black/60" />
          
          <div className="relative z-10 flex flex-col items-center justify-center h-full w-full px-6 text-center -mt-32">
            <div className="max-w-md">
              <h2 className="text-3xl font-medium leading-tight text-white mb-6 drop-shadow-lg">
                Every career milestone in logistics is a story of human ingenuity.
              </h2>
              {/* <div className="mx-auto h-1.5 w-16 bg-blue-500 rounded-full shadow-lg" /> */}
              {/* <p className="relative top-8 text-sm text-white/100 font-light tracking-wide drop-shadow-md">
                Powering the backbone of global commerce.
              </p> */}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
