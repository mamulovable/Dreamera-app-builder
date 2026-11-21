import { AdminPageHeader, DataTable, EmptyNote, Panel, RowLink, StatCard, StatGrid, StatusBadge, formatWhen } from "@/components/admin/admin-ui"
import { getAdminAiCalls } from "@/lib/admin"

const TASK_LABEL = {
  text: "Text",
  transcribe: "Speech to text",
  speech: "Text to speech",
  vision: "Photo",
} as const

function count(value: number | null | undefined) {
  return value == null ? "—" : value.toLocaleString()
}

function seconds(value: number | null | undefined) {
  return value == null ? "—" : `${value.toFixed(1)}s`
}

function duration(value: number | null | undefined) {
  if (value == null) return "—"
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

function statusClass(status: string) {
  if (status === "succeeded") return "border-emerald-500/40 text-emerald-700"
  if (status === "failed") return "border-destructive/40 text-destructive"
  return "border-amber-500/40 text-amber-700"
}

export default async function AdminAiPage() {
  const { today, rows } = await getAdminAiCalls()

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="AI calls"
        description="Each request a generated app made: the model, token counts, the owner, the app, and the Dreamera credits it cost."
      />

      <StatGrid>
        <StatCard label="Calls today" value={today.calls} hint={`${today.succeeded.toLocaleString()} succeeded`} />
        <StatCard
          label="Credits today"
          value={today.credits}
          hint="Kept after refunds"
          tone={today.credits > 0 ? "ok" : "default"}
        />
        <StatCard
          label="Input tokens"
          value={today.promptTokens}
          hint={`${today.completionTokens.toLocaleString()} output tokens`}
        />
        <StatCard
          label="Failed or blocked"
          value={today.failed + today.blocked}
          hint={`${today.failed.toLocaleString()} failed · ${today.blocked.toLocaleString()} blocked`}
          tone={today.failed + today.blocked > 0 ? "warn" : "default"}
        />
      </StatGrid>

      <Panel title="Recent calls" action={<span className="text-xs text-muted-foreground">Latest 100</span>}>
        {rows.length === 0 ? (
          <EmptyNote>No AI calls yet. They show up after someone uses AI inside a generated app.</EmptyNote>
        ) : (
          <DataTable headers={["When", "User", "App", "Kind", "Model", "Tokens in", "Tokens out", "Tokens", "Audio", "Credits", "Time", "Status", "Input and reply"]}>
            {rows.map((call) => (
              <tr key={call.id} className="align-top">
                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{formatWhen(call.createdAt)}</td>
                <td className="px-3 py-2.5">
                  {call.userId ? <RowLink href={`/admin/users/${call.userId}`}>{call.userEmail}</RowLink> : call.userEmail}
                </td>
                <td className="px-3 py-2.5">
                  {call.projectId ? (
                    <RowLink href={`/admin/projects/${call.projectId}`}>{call.projectTitle}</RowLink>
                  ) : (
                    call.projectTitle
                  )}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">{TASK_LABEL[call.task]}</td>
                <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{call.model ?? "—"}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(call.promptTokens)}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(call.completionTokens)}</td>
                <td className="px-3 py-2.5 tabular-nums">{count(call.totalTokens)}</td>
                <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{seconds(call.audioSeconds)}</td>
                <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">
                  {call.credits.toLocaleString()}
                  {call.refunded ? <span className="mt-0.5 block text-xs text-muted-foreground">refunded</span> : null}
                </td>
                <td className="px-3 py-2.5 tabular-nums whitespace-nowrap">{duration(call.durationMs)}</td>
                <td className="px-3 py-2.5">
                  <StatusBadge label={call.status} className={statusClass(call.status)} />
                  {call.error ? <p className="mt-1 max-w-48 text-xs text-destructive">{call.error}</p> : null}
                </td>
                <td className="max-w-sm px-3 py-2.5 text-xs">
                  {call.inputPreview ? <p className="text-muted-foreground">{call.inputPreview}</p> : null}
                  {call.outputPreview ? <p className="mt-1">{call.outputPreview}</p> : null}
                  {call.inputBytes ? (
                    <p className="mt-1 text-muted-foreground">{(call.inputBytes / 1024).toFixed(0)} KB uploaded</p>
                  ) : null}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
