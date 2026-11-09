import postgres from "postgres"
import "dotenv/config"

const sql = postgres(process.env.DIRECT_URL, { ssl: "require", max: 1 })

const projects = await sql`
  select id, title, status, updated_at
  from projects
  order by updated_at desc
  limit 5
`
console.log("PROJECTS", JSON.stringify(projects, null, 2))

const builds = await sql`
  select b.id, b.project_id, p.title, b.status, b.step, b.job_id, b.updated_at
  from builds b
  join projects p on p.id = b.project_id
  order by b.updated_at desc
  limit 5
`
console.log("BUILDS", JSON.stringify(builds, null, 2))

if (projects[0]) {
  const screens = await sql`
    select name, status, position, (code is not null) as has_code
    from screens
    where project_id = ${projects[0].id}
    order by position
  `
  console.log("SCREENS", JSON.stringify(screens, null, 2))
  const msgs = await sql`
    select role, left(content, 160) as content, created_at
    from messages
    where project_id = ${projects[0].id}
    order by created_at desc
    limit 4
  `
  console.log("MSGS", JSON.stringify(msgs, null, 2))
}

await sql.end()
