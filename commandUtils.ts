import type { DownloadTool } from "./types"

export interface CommandGenerationParams {
  originalUrl: string
  filename: string | undefined
  requestHeaders: Record<string, string> | undefined
  cookies: string | undefined
  userAgent: string | undefined
  referer: string | undefined
  tool: DownloadTool
}

export const generateCliCommand = ({
  originalUrl,
  filename,
  requestHeaders,
  cookies,
  userAgent,
  referer,
  tool
}: CommandGenerationParams): string => {
  let command = ""
  const escapedUrl = `'${originalUrl.replace(/'/g, "'\\''")}'`
  const effectiveUserAgent =
    userAgent ||
    (typeof navigator !== "undefined"
      ? navigator.userAgent
      : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36")

  const headersToUse = { ...requestHeaders }

  const addHeader = (
    key: string,
    value: string,
    toolType: "wget" | "curl" | "aria2"
  ) => {
    const lowerKey = key.toLowerCase()
    if (
      lowerKey === "user-agent" ||
      lowerKey === "cookie" ||
      lowerKey === "referer"
    ) {
      return ""
    }
    const escapedValue = value.replace(/'/g, "'\\''")
    if (toolType === "wget" || toolType === "aria2") {
      return ` --header='${key}: ${escapedValue}'`
    } else {
      return ` -H '${key}: ${escapedValue}'`
    }
  }

  switch (tool) {
    case "wget":
      command = `wget -c --header='User-Agent: ${effectiveUserAgent}'`
      if (cookies) command += ` --header='Cookie: ${cookies}'`
      if (referer) command += ` --referer='${referer}'`
      if (headersToUse) {
        for (const key in headersToUse) {
          if (headersToUse.hasOwnProperty(key)) {
            command += addHeader(key, headersToUse[key], "wget")
          }
        }
      }
      command += ` -O '${filename || "downloaded_file"}' ${escapedUrl}`
      break
    case "aria2":
      command = `aria2c -c -x5 -s5 -k1M --user-agent='${effectiveUserAgent}'`
      if (cookies) command += ` --header='Cookie: ${cookies}'`
      if (referer) command += ` --referer='${referer}'`
      if (headersToUse) {
        for (const key in headersToUse) {
          if (headersToUse.hasOwnProperty(key)) {
            command += addHeader(key, headersToUse[key], "aria2")
          }
        }
      }
      command += ` -o '${filename || "downloaded_file"}' ${escapedUrl}`
      break
    case "curl":
    default:
      command = `curl -L -J -O -C - ${escapedUrl}`
      command += ` -H 'User-Agent: ${effectiveUserAgent}'`
      if (cookies) command += ` -H 'Cookie: ${cookies}'`
      if (referer) command += ` -H 'Referer: ${referer}'`
      if (headersToUse) {
        for (const key in headersToUse) {
          if (headersToUse.hasOwnProperty(key)) {
            command += addHeader(key, headersToUse[key], "curl")
          }
        }
      }
      break
  }
  return command
}
