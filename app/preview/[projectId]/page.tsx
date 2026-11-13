import { SitePreview } from "@/components/workspace/site-preview-page"

export default async function PreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  return <SitePreview projectId={projectId} />
}
