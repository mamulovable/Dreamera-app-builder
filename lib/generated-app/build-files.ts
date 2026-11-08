// What a project gets once it has been published: its EAS profiles, and the
// EAS workflows that build each file type and deploy its website. No file here holds a secret.

import { FORMAT_PLATFORM, type AppBuildFormat } from "@/lib/publish-protocol"

/** Each format has a profile of the same name. */
const EAS_PROFILES: Record<AppBuildFormat, object> = {
  aab: { distribution: "store", autoIncrement: true, android: { buildType: "app-bundle" } },
  apk: { distribution: "internal", autoIncrement: true, android: { buildType: "apk" } },
  ipa: { distribution: "store", autoIncrement: true },
}

// With a remote version source, EAS keeps versionCode and buildNumber, so nothing has to be saved back.
export const EAS_JSON = `${JSON.stringify(
  {
    cli: { version: ">= 16.0.0", appVersionSource: "remote", promptToConfigurePushNotifications: false },
    build: EAS_PROFILES,
  },
  null,
  2
)}\n`

/** The workflow that builds one file type. EAS runs it from the text sent with the build, so it isn't a project file. */
export function buildWorkflow(format: AppBuildFormat) {
  return {
    fileName: `appforge-${format}.yml`,
    yamlConfig: [
      `name: AppForge .${format}`,
      "",
      "jobs:",
      "  build:",
      "    type: build",
      // The project reaches EAS as a plain archive with no .git, and without this the CLI stops to offer `git init`.
      "    env:",
      '      EAS_NO_VCS: "1"',
      "    params:",
      `      platform: ${FORMAT_PLATFORM[format]}`,
      `      profile: ${format}`,
      "",
    ].join("\n"),
  }
}

/** The workflow that exports the app for the web and makes it the live version of its EAS Hosting site. */
export function webWorkflow() {
  return {
    fileName: "appforge-web.yml",
    yamlConfig: [
      "name: AppForge web",
      "",
      "jobs:",
      "  deploy:",
      "    type: deploy",
      "    environment: production",
      // As with a build, the project reaches EAS with no .git.
      "    env:",
      '      EAS_NO_VCS: "1"',
      "    params:",
      "      prod: true",
      "",
    ].join("\n"),
  }
}

/** The files a published project keeps in every export, so it can also be built by hand with the EAS CLI. */
export function publishFiles() {
  return [{ path: "eas.json", content: EAS_JSON }]
}
