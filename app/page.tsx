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
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[1200px] overflow-hidden">
      <div className="absolute -top-48 left-1/2 size-[640px] -translate-x-[95%] rounded-full bg-brand/20 blur-[140px] animate-blob" />
      <div className="absolute -top-32 left-1/2 size-[560px] translate-x-[5%] rounded-full bg-brand-accent/15 blur-[130px] animate-blob [animation-delay:-7s]" />
      <div className="absolute top-[420px] left-1/2 size-[480px] -translate-x-1/2 rounded-full bg-brand/12 blur-[120px] animate-blob [animation-delay:-12s]" />
      <div className="absolute inset-x-0 bottom-0 h-48 bg-linear-to-b from-transparent to-background" />
    </div>
  )
}
