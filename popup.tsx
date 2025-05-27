import '@mantine/core/styles.css'
import '@mantine/code-highlight/styles.css'
import 'highlight.js/styles/atom-one-light.min.css'

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  MantineProvider,
  Button,
  Switch,
  Select,
  Stack,
  ScrollArea,
  Card,
  Text,
  Group,
  ActionIcon,
  Badge,
  Loader,
  Title,
  Divider,
  Box,
  CopyButton,
  Tooltip,
  Center
} from '@mantine/core'
import { CodeHighlight, CodeHighlightAdapterProvider, createHighlightJsAdapter } from '@mantine/code-highlight'
import hljs from 'highlight.js/lib/core'
import bashLang from 'highlight.js/lib/languages/bash'
import { IconTrash, IconExternalLink, IconCopy, IconCheck, IconSettings, IconPower } from '@tabler/icons-react'
import { formatDistanceToNowStrict } from 'date-fns'

import type { StoredCommand, DownloadTool } from './types'
import { generateCliCommand } from './commandUtils'

hljs.registerLanguage('bash', bashLang)
const highlightJsAdapter = createHighlightJsAdapter(hljs)

const TOOL_OPTIONS: { value: DownloadTool; label: string }[] = [
  { value: 'curl', label: 'cURL' },
  { value: 'wget', label: 'Wget' },
  { value: 'aria2', label: 'Aria2c' },
]

interface CommandCardProps {
  cmd: StoredCommand
  globalDisplayTool: DownloadTool
  onDelete: (commandId: string) => void
  onViewSource: (url: string) => void
}

function CommandCard({ cmd, globalDisplayTool, onDelete, onViewSource }: CommandCardProps) {
  const canRegenerate = !!(cmd.originalUrl && cmd.userAgent !== undefined && cmd.cookies !== undefined && cmd.requestHeaders !== undefined)

  const currentCommandString = useMemo(() => {
    if (canRegenerate) {
      return generateCliCommand({
        originalUrl: cmd.originalUrl,
        filename: cmd.filename,
        requestHeaders: cmd.requestHeaders!,
        cookies: cmd.cookies!,
        userAgent: cmd.userAgent!,
        referer: cmd.referer,
        tool: globalDisplayTool,
      })
    }
    return cmd.command
  }, [cmd, globalDisplayTool, canRegenerate])

  return (
    <Card shadow="sm" p="md" radius="md" withBorder>
      <Stack gap="md">
        <Group justify="space-between">
          <Group gap="sm">
            {cmd.isNew && <Badge color="green" variant="filled" size="sm">New</Badge>}
            <Badge color="blue" variant="light">
              {formatDistanceToNowStrict(new Date(cmd.timestamp), { addSuffix: true })}
            </Badge>
          </Group>
          <Group gap="sm">
            <CopyButton value={currentCommandString} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? "Copied!" : "Copy Command"} withArrow>
                  <ActionIcon variant="subtle" color={copied ? "teal" : "blue"} onClick={copy}>
                    {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
            {cmd.referer && (
              <Tooltip label="View Source URL (Referer)" withArrow>
                <ActionIcon variant="subtle" color="blue" onClick={() => onViewSource(cmd.referer!)}>
                  <IconExternalLink size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="View Original Download URL" withArrow>
              <ActionIcon variant="subtle" color="cyan" onClick={() => onViewSource(cmd.originalUrl)}>
                <IconExternalLink size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Delete Command" withArrow>
              <ActionIcon variant="subtle" color="red" onClick={() => onDelete(cmd.id)}>
                <IconTrash size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {cmd.filename && <Text size="xs" c="dimmed" mt="sm">File: {cmd.filename}</Text>}
        {!canRegenerate && globalDisplayTool !== cmd.tool && (
          <Text size="xs" c="dimmed" mt="sm">
            (Cannot regenerate with {TOOL_OPTIONS.find(t => t.value === globalDisplayTool)?.label || globalDisplayTool}: full details not stored)
          </Text>
        )}
        <Box mt="xs">
          <CodeHighlight code={currentCommandString} language="bash" styles={{ code: { fontSize: '0.8rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }} />
        </Box>
      </Stack>
    </Card>
  )
}

function IndexPopup() {
  const [savedCommands, setSavedCommands] = useState<StoredCommand[]>([])
  const [isInterceptorEnabled, setIsInterceptorEnabled] = useState<boolean>(true)
  const [selectedTool, setSelectedTool] = useState<DownloadTool>('curl')
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const loadStorageData = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await chrome.storage.local.get(['savedCommands', 'isInterceptorEnabled', 'selectedTool'])
      const loadedCommands = (data.savedCommands || []) as StoredCommand[]
      const now = Date.now()
      const updatedCommands = loadedCommands.map(cmd => ({
        ...cmd,
        isNew: cmd.isNew && (now - cmd.timestamp < 5 * 60 * 1000)
      }))
      setSavedCommands(updatedCommands)

      if (typeof data.isInterceptorEnabled === 'boolean') {
        setIsInterceptorEnabled(data.isInterceptorEnabled)
      }
      const storedTool = data.selectedTool as DownloadTool
      if (TOOL_OPTIONS.some(option => option.value === storedTool)) {
        setSelectedTool(storedTool)
      } else {
        setSelectedTool('curl')
        if (storedTool) {
          await chrome.storage.local.set({ selectedTool: 'curl' })
        }
      }
    } catch (error) {
      setSavedCommands([])
      setIsInterceptorEnabled(true)
      setSelectedTool('curl')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStorageData()
    const storageChangedListener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local') {
        if (changes.savedCommands) {
          const newCommandsFromStorage = (changes.savedCommands.newValue || []) as StoredCommand[]
          const now = Date.now()
          setSavedCommands(newCommandsFromStorage.map(cmd => ({
            ...cmd,
            isNew: cmd.isNew && (now - cmd.timestamp < 5 * 60 * 1000)
          })))
        }
        if (changes.isInterceptorEnabled && typeof changes.isInterceptorEnabled.newValue === 'boolean') {
          setIsInterceptorEnabled(changes.isInterceptorEnabled.newValue)
        }
        if (changes.selectedTool && changes.selectedTool.newValue) {
          const newTool = changes.selectedTool.newValue as DownloadTool
          if (TOOL_OPTIONS.some(option => option.value === newTool)) {
            setSelectedTool(newTool)
          }
        }
      }
    }
    chrome.storage.onChanged.addListener(storageChangedListener)
    return () => chrome.storage.onChanged.removeListener(storageChangedListener)
  }, [loadStorageData])

  const handleToggleInterceptor = async (enabled: boolean) => {
    setIsInterceptorEnabled(enabled)
    await chrome.storage.local.set({ isInterceptorEnabled: enabled })
  }

  const handleGlobalToolChange = async (value: string | null) => {
    if (value) {
      const tool = value as DownloadTool
      setSelectedTool(tool)
      await chrome.storage.local.set({ selectedTool: tool })
    }
  }

  const handleDeleteCommand = async (commandId: string) => {
    const updatedCommands = savedCommands.filter(cmd => cmd.id !== commandId)
    setSavedCommands(updatedCommands)
    await chrome.storage.local.set({ savedCommands: updatedCommands })
  }

  const handleClearAllCommands = async () => {
    setSavedCommands([])
    await chrome.storage.local.set({ savedCommands: [] })
  }

  const handleViewSource = (url: string) => {
    chrome.tabs.create({ url })
  }

  if (isLoading) {
    return (<Center style={{ height: 400, width: 500 }}><Loader /></Center>)
  }

  return (
    <Box p='lg' style={{ width: 500, minHeight: 400 }}>
      <Stack gap="xl">
        <Group justify="space-between">
          <Stack>
            <Title order={2}>Arify</Title>
            <Text c='gray'>Download interceptor</Text>
          </Stack>
          <Switch
            checked={isInterceptorEnabled}
            onChange={(event) => handleToggleInterceptor(event.currentTarget.checked)}
            label={isInterceptorEnabled ? "Interceptor ON" : "Interceptor OFF"}
            thumbIcon={isInterceptorEnabled ? <IconPower size={12} /> : <IconPower color="gray" size={12} />}
            size="lg"
            color={isInterceptorEnabled ? "teal" : "gray"}
          />
        </Group>

        <Select
          label="CLI Tool"
          data={TOOL_OPTIONS}
          value={selectedTool}
          onChange={handleGlobalToolChange}
          leftSection={<IconSettings size={16} />}
          allowDeselect={false}
        />

        <Group justify="space-between" align="center" mt="md">
          <Text size="lg" fw={500}>Generated Commands</Text>
          {savedCommands.length > 0 && (
            <Button variant="outline" color="red" size="xs" onClick={handleClearAllCommands} leftSection={<IconTrash size={14} />}>
              Clear All
            </Button>
          )}
        </Group>

        {savedCommands.length === 0 ? (
          <Text c="dimmed" ta="center" mt="xl">
            No commands generated yet. Try downloading a file.
          </Text>
        ) : (
          <Stack gap="lg">
            {savedCommands.map((cmd) => (
              <CommandCard
                key={cmd.id}
                cmd={cmd}
                globalDisplayTool={selectedTool}
                onDelete={handleDeleteCommand}
                onViewSource={handleViewSource}
              />
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

export default function App() {
  return (
    <MantineProvider>
      <CodeHighlightAdapterProvider adapter={highlightJsAdapter}>
        <IndexPopup />
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  )
}