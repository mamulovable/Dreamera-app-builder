"use client"

import Link from "next/link"
import * as React from "react"
import {
  CoinsIcon,
  FolderIcon,
  GaugeIcon,
  Loader2Icon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react"

import { useAuth, type SessionUser } from "@/lib/auth-client"
import { PLANS, type PlanId } from "@/lib/plans"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Logo } from "@/components/home/logo"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

const NAV_LINKS = [
  { label: "Explore", href: "/#explore" },
  { label: "Templates", href: "/#templates" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: "/#docs" },
]

export function SiteHeader() {
  const { user, isPending } = useAuth()
  const { openSignIn } = useSignInDialog()

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 rounded-full border border-white/60 bg-white/65 pr-2 pl-3 shadow-[0_8px_32px_-12px_rgba(76,29,149,0.25)] ring-1 ring-black/[0.03] backdrop-blur-xl sm:pl-4">
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="AppForge home">
            <Logo className="size-8 rounded-full" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-700"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {isPending ? (
            <Skeleton className="size-10 rounded-full" />
          ) : user ? (
            <>
              <CreditsBadge credits={user.credits} plan={user.plan} />
              <UserMenu user={user} />
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="lg"
                className="hidden h-10 rounded-full px-4 sm:inline-flex"
                onClick={() => openSignIn("sign-in")}
              >
                Sign in
              </Button>
              <Button
                size="lg"
                className="h-10 rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-5 text-white shadow-md shadow-violet-500/30 transition-transform hover:scale-[1.03] hover:opacity-95"
                onClick={() => openSignIn("sign-up")}
              >
                Get started
              </Button>
            </>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-full md:hidden"
                  aria-label="Open menu"
                />
              }
            >
              <MenuIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 rounded-2xl">
              {NAV_LINKS.map((link) => (
                <DropdownMenuItem
                  key={link.label}
                  render={<Link href={link.href} />}
                  className="py-2"
                >
                  {link.label}
                </DropdownMenuItem>
              ))}
              {!user && !isPending && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="py-2"
                    onClick={() => openSignIn("sign-in")}
                  >
                    Sign in
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

function CreditsBadge({ credits, plan }: { credits: number; plan: PlanId }) {
  return (
    <Link
      href="/pricing"
      title={`${credits} credits remaining on the ${PLANS[plan].name} plan`}
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-500/10 px-3 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-500/15"
    >
      <CoinsIcon className="size-4" />
      {credits.toLocaleString()}
      <span className="sr-only sm:not-sr-only">credits</span>
    </Link>
  )
}

function UserMenu({ user }: { user: SessionUser }) {
  const { signOut } = useAuth()
  const [signingOut, setSigningOut] = React.useState(false)
  const { name, email, image, plan } = user
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        aria-label="Open account menu"
      >
        <Avatar size="lg" className="size-10 ring-2 ring-white">
          {image && <AvatarImage src={image} alt={name} />}
          <AvatarFallback className="bg-linear-to-br from-indigo-100 to-violet-100 font-medium text-violet-700">
            {initials}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 rounded-2xl">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 py-1.5">
            <p className="truncate text-sm font-medium text-foreground">
              {name}
            </p>
            <p className="truncate text-xs font-normal">{email}</p>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="py-2" render={<Link href="/pricing" />}>
          <SparklesIcon />
          {plan === "pro" ? "Manage Pro plan" : "Upgrade to Pro"}
        </DropdownMenuItem>
        <DropdownMenuItem className="py-2" render={<Link href="/billing" />}>
          <GaugeIcon />
          Usage &amp; billing
        </DropdownMenuItem>
        <DropdownMenuItem
          className="py-2"
          render={<Link href="/#projects" />}
        >
          <FolderIcon />
          My projects
        </DropdownMenuItem>
        <DropdownMenuItem className="py-2">
          <SettingsIcon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="py-2"
          disabled={signingOut}
          onClick={async () => {
            setSigningOut(true)
            await signOut()
            setSigningOut(false)
          }}
        >
          {signingOut ? <Loader2Icon className="animate-spin" /> : <LogOutIcon />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
