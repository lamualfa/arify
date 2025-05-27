export type DownloadTool = "wget" | "curl" | "aria2"

export interface StoredSettings {
  isInterceptorEnabled?: boolean
  selectedTool?: DownloadTool
}

export interface StoredCommand {
  id: string
  command: string
  originalUrl: string
  referer?: string
  timestamp: number
  tool: DownloadTool
  isNew?: boolean
  filename?: string
  requestHeaders?: Record<string, string>
  cookies?: string
  userAgent?: string
}
