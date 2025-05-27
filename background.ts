import { generateCliCommand } from "./commandUtils"
import type { DownloadTool, StoredCommand, StoredSettings } from "./types"

console.log("Arify Extension: Background script loaded.")

interface DownloadItemWithHeaders extends chrome.downloads.DownloadItem {
  requestHeaders?: chrome.webRequest.HttpHeader[]
}

const getAllRequestHeaders = (
  headers: chrome.webRequest.HttpHeader[] | undefined
): Record<string, string> => {
  const result: Record<string, string> = {}
  if (headers) {
    for (const header of headers) {
      if (header.name && header.value) {
        if (header.name.toLowerCase() !== "cookie") {
          result[header.name] = header.value
        }
      }
    }
  }
  return result
}

const getCookies = async (url: string): Promise<string> => {
  return new Promise((resolve) => {
    if (!chrome.cookies) {
      console.warn("Arify Extension: chrome.cookies API not available.")
      resolve("")
      return
    }

    const primaryUrl = url

    chrome.cookies.getAll({ url: primaryUrl }, (cookiesFromUrl) => {
      let primaryError = false
      if (chrome.runtime.lastError) {
        console.error(
          `Arify Extension: Error getting cookies for URL ${primaryUrl}:`,
          chrome.runtime.lastError.message
        )
        primaryError = true
      }

      let allFetchedCookies: chrome.cookies.Cookie[] = []
      if (cookiesFromUrl && !primaryError) {
        allFetchedCookies = allFetchedCookies.concat(cookiesFromUrl)
      }

      try {
        const parsedUrl = new URL(primaryUrl)
        const hostname = parsedUrl.hostname

        chrome.cookies.getAll(
          { domain: hostname },
          (cookiesFromExactDomain) => {
            if (chrome.runtime.lastError) {
              console.error(
                `Arify Extension: Error getting cookies for exact domain ${hostname}:`,
                chrome.runtime.lastError.message
              )
            } else if (
              cookiesFromExactDomain &&
              cookiesFromExactDomain.length > 0
            ) {
              allFetchedCookies = allFetchedCookies.concat(
                cookiesFromExactDomain
              )
            }

            const domainParts = hostname.split(".")
            if (domainParts.length > 1) {
              const parentDomainAttempt =
                "." +
                (domainParts.length > 2
                  ? domainParts.slice(1).join(".")
                  : hostname)
              if (parentDomainAttempt !== "." + hostname) {
                chrome.cookies.getAll(
                  { domain: parentDomainAttempt },
                  (cookiesFromParentDomain) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        `Arify Extension: Error getting cookies for parent domain ${parentDomainAttempt}:`,
                        chrome.runtime.lastError.message
                      )
                    } else if (
                      cookiesFromParentDomain &&
                      cookiesFromParentDomain.length > 0
                    ) {
                      allFetchedCookies = allFetchedCookies.concat(
                        cookiesFromParentDomain
                      )
                    }
                    finalizeAndResolveCookies()
                  }
                )
              } else {
                finalizeAndResolveCookies()
              }
            } else {
              finalizeAndResolveCookies()
            }
          }
        )

        const finalizeAndResolveCookies = () => {
          const uniqueCookieKeys = new Set<string>()
          const uniqueCookies = allFetchedCookies.filter((cookie) => {
            const key = `${cookie.name}|${cookie.domain}|${cookie.path}`
            if (uniqueCookieKeys.has(key)) {
              return false
            }
            uniqueCookieKeys.add(key)
            return true
          })

          if (uniqueCookies.length > 0) {
            console.log(
              `Arify Extension: Total ${uniqueCookies.length} unique cookie(s) processed for ${primaryUrl}.`
            )
          }
          resolve(
            uniqueCookies
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; ")
          )
        }
      } catch (e) {
        console.error(
          `Arify Extension: Error processing URL ${primaryUrl} for domain-based cookie query:`,
          e
        )
        const uniqueCookies = Array.from(
          new Map(
            allFetchedCookies.map((cookie) => [
              `${cookie.name}|${cookie.domain}|${cookie.path}`,
              cookie
            ])
          ).values()
        )
        resolve(
          uniqueCookies
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join("; ")
        )
      }
    })
  })
}

chrome.downloads.onDeterminingFilename.addListener(
  (
    downloadItemSuggest: chrome.downloads.DownloadItem,
    suggest: (suggestion?: chrome.downloads.DownloadFilenameSuggestion) => void
  ) => {
    const downloadItem = downloadItemSuggest as DownloadItemWithHeaders
    console.log(
      "Arify Extension: onDeterminingFilename triggered for:",
      downloadItem.url
    )

    chrome.storage.local.get(
      ["isInterceptorEnabled", "selectedTool"],
      async (settings: StoredSettings) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Arify Extension: Error retrieving settings:",
            chrome.runtime.lastError.message
          )
          suggest()
          return
        }

        const { isInterceptorEnabled = true, selectedTool = "curl" } = settings

        if (!isInterceptorEnabled) {
          console.log(
            "Arify Extension: Interceptor is disabled. Allowing download."
          )
          suggest()
          return true
        }

        if (!downloadItem.url) {
          console.warn(
            "Arify Extension: Download item has no URL. Allowing download."
          )
          suggest()
          return
        }

        console.log(
          `Arify Extension: Intercepting download: ${downloadItem.url}`
        )

        const cookies = await getCookies(downloadItem.url)
        const requestHeadersFromDownloadItem = getAllRequestHeaders(
          downloadItem.requestHeaders
        )
        const userAgent = navigator.userAgent
        const referer =
          downloadItem.referrer ||
          requestHeadersFromDownloadItem["Referer"] ||
          requestHeadersFromDownloadItem["referer"]

        const command = generateCliCommand({
          originalUrl: downloadItem.url,
          filename: downloadItem.filename,
          requestHeaders: requestHeadersFromDownloadItem,
          cookies: cookies,
          userAgent: userAgent,
          referer: referer,
          tool: selectedTool
        })

        const newCommandEntry: StoredCommand = {
          id: String(downloadItem.id),
          command,
          originalUrl: downloadItem.url,
          referer: referer,
          timestamp: downloadItem.startTime
            ? new Date(downloadItem.startTime).getTime()
            : Date.now(),
          tool: selectedTool,
          isNew: true,
          filename: downloadItem.filename,
          requestHeaders: requestHeadersFromDownloadItem,
          cookies: cookies,
          userAgent: userAgent
        }

        chrome.storage.local.get(
          { savedCommands: [] },
          (data: { savedCommands?: StoredCommand[] }) => {
            if (chrome.runtime.lastError) {
              console.error(
                "Arify Extension: Error retrieving saved commands:",
                chrome.runtime.lastError.message
              )
              suggest()
              return
            }
            const currentCommands = data.savedCommands || []
            const updatedCommands = [newCommandEntry, ...currentCommands]
            chrome.storage.local.set({ savedCommands: updatedCommands }, () => {
              if (chrome.runtime.lastError) {
                console.error(
                  "Arify Extension: Error saving command:",
                  chrome.runtime.lastError.message
                )
                suggest()
                return
              }
              console.log(
                "Arify Extension: Command saved to storage:",
                newCommandEntry.id
              )

              const finalSuggest = (
                conflict: chrome.downloads.FilenameConflictAction = "uniquify"
              ) => {
                suggest({
                  filename: downloadItem.filename,
                  conflictAction: conflict
                })
                console.log(
                  `Arify Extension: Called suggest() for ${downloadItem.filename} with action ${conflict}.`
                )
              }

              let downloadIdToCancel: number | undefined = undefined
              if (
                typeof downloadItem.id === "number" &&
                !isNaN(downloadItem.id)
              ) {
                downloadIdToCancel = downloadItem.id
              } else if (typeof downloadItem.id === "string") {
                const parsedId = parseInt(downloadItem.id, 10)
                if (!isNaN(parsedId)) {
                  downloadIdToCancel = parsedId
                } else {
                  console.error(
                    `Arify Extension: Download ID string "${downloadItem.id}" could not be parsed to a valid number for cancellation.`
                  )
                }
              } else {
                console.error(
                  `Arify Extension: Download ID "${downloadItem.id}" (type: ${typeof downloadItem.id}) is not a valid number or string for cancellation.`
                )
              }

              if (downloadIdToCancel !== undefined) {
                console.log(
                  `Arify Extension: Attempting to cancel download ID: ${downloadIdToCancel}`
                )
                chrome.downloads.cancel(downloadIdToCancel, () => {
                  if (chrome.runtime.lastError) {
                    console.warn(
                      `Arify Extension: Could not cancel download (ID: ${downloadItem.id}): ${chrome.runtime.lastError.message}. It might have already completed or been cancelled by other means.`
                    )
                  } else {
                    console.log(
                      "Arify Extension: Download successfully cancelled by extension:",
                      downloadItem.id
                    )
                  }
                  finalSuggest()
                })
              } else {
                console.warn(
                  "Arify Extension: No valid Download ID to cancel. Calling suggest() to finalize download event."
                )
                finalSuggest("uniquify")
              }

              if (chrome.notifications) {
                const notifId = `arify-dl-${Date.now()}-${downloadItem.id}`
                chrome.notifications.create(
                  notifId,
                  {
                    type: "basic",
                    iconUrl: chrome.runtime.getURL("assets/icon.png"),
                    title: "Download Intercepted",
                    message: `CLI command generated for: ${downloadItem.filename || "file"}`,
                    priority: 0
                  },
                  (createdNotificationId) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        `Arify Extension: Notification error for ID ${notifId}:`,
                        chrome.runtime.lastError.message
                      )
                    } else {
                      if (createdNotificationId) {
                        console.log(
                          `Arify Extension: Notification ${createdNotificationId} shown for: ${downloadItem.filename || downloadItem.url}`
                        )
                      } else {
                        console.warn(
                          `Arify Extension: Notification was attempted for ${downloadItem.filename || downloadItem.url}, but create callback received no ID.`
                        )
                      }
                    }
                  }
                )
              }
            })
          }
        )
      }
    )
    return true
  }
)

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.storage.local.set(
      {
        isInterceptorEnabled: true,
        selectedTool: "curl",
        savedCommands: []
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            "Arify Extension: Error setting default settings on install:",
            chrome.runtime.lastError.message
          )
        } else {
          console.log("Arify Extension: Default settings saved on install.")
        }
      }
    )
  }
})

console.log("Arify Extension: Background script event listeners attached.")
