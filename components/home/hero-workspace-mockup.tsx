import Image from "next/image"

export function HeroWorkspaceMockup() {
  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl sm:mt-20">
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-8 rounded-[3rem] bg-linear-to-br from-brand/25 via-brand-accent/10 to-transparent opacity-80 blur-3xl"
      />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-white/70 bg-white/50 shadow-[0_40px_100px_-40px_rgba(76,29,149,0.55)] ring-1 ring-black/[0.04] backdrop-blur-md sm:rounded-[2rem]">
        <div className="flex items-center gap-2 border-b border-black/[0.05] bg-white/80 px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 truncate rounded-full bg-muted/80 px-3 py-0.5 text-[11px] font-medium text-muted-foreground">
            dreamera.app / workspace
          </span>
        </div>
        <Image
          src="/marketing/workspace-plantopedia.jpg"
          alt="Dreamera workspace showing AI chat, a multi-screen app canvas, and a live phone preview"
          width={1940}
          height={942}
          priority
          sizes="(max-width: 1024px) 100vw, 1024px"
          className="block h-auto w-full"
        />
      </div>
    </div>
  )
}
