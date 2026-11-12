import { HomeContent } from "@/components/home/home-content"
import { SignInDialogProvider } from "@/components/home/sign-in-dialog"
import { SiteHeader } from "@/components/home/site-header"

export default function Home() {
  return (
    <SignInDialogProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background">
        <BackgroundDecor />
        <SiteHeader />
        <HomeContent />
      </div>
    </SignInDialogProvider>
  )
}

function BackgroundDecor() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[980px] overflow-hidden">
      <div className="absolute -top-40 left-1/2 size-[520px] -translate-x-[110%] animate-blob rounded-full bg-brand/25 blur-[100px]" />
      <div className="absolute -top-20 left-1/2 size-[480px] translate-x-[10%] animate-blob rounded-full bg-brand-accent/20 blur-[100px] [animation-delay:-6s]" />
      <div className="absolute top-60 left-1/2 size-[420px] -translate-x-1/2 animate-blob rounded-full bg-brand/15 blur-[110px] [animation-delay:-12s]" />
      <div className="absolute inset-0 bg-[radial-gradient(rgba(0,0,0,0.07)_1px,transparent_1px)] mask-[radial-gradient(ellipse_60%_55%_at_50%_10%,black,transparent)] bg-size-[22px_22px]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
    </div>
  )
}
