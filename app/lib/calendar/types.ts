export type CalendarProviderId = 'google' | 'icloud'

export type CalendarDateTime = {
  date?: string
  dateTime?: string
  timeZone?: string
}

export type CalendarEventInput = {
  id?: string
  summary: string
  description?: string
  location?: string
  start: CalendarDateTime
  end: CalendarDateTime
  extendedProperties?: { private?: Record<string, string> }
}

export type CalendarEvent = CalendarEventInput & {
  id: string
  etag?: string
  status?: string
  updated?: string
}

export type CalendarChangePage = {
  events: CalendarEvent[]
  nextPageToken?: string
  nextSyncToken?: string
}

export type BusySlot = { start: string; end: string }

export type WatchChannel = {
  channelId: string
  resourceId: string
  expiration?: string
}

export type CalendarProvider = {
  id: CalendarProviderId
  createCalendar(summary: string, timeZone: string): Promise<{ id: string; summary?: string }>
  getCalendar(calendarId: string): Promise<{ id: string; summary?: string } | null>
  createEvent(calendarId: string, event: CalendarEventInput): Promise<CalendarEvent>
  updateEvent(calendarId: string, eventId: string, event: CalendarEventInput): Promise<CalendarEvent>
  deleteEvent(calendarId: string, eventId: string): Promise<void>
  getEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null>
  getChanges(calendarId: string, options: { syncToken?: string; pageToken?: string }): Promise<CalendarChangePage>
  getAvailability(calendarIds: string[], timeMin: string, timeMax: string, timeZone: string): Promise<BusySlot[]>
  watch(calendarId: string, webhookUrl: string, channelId: string): Promise<WatchChannel>
  unwatch(channelId: string, resourceId: string): Promise<void>
}

export class CalendarSyncGoneError extends Error {
  constructor() {
    super('Calendar sync token is no longer valid')
    this.name = 'CalendarSyncGoneError'
  }
}

export class CalendarAuthError extends Error {
  constructor() {
    super('Google Calendar authorization expired')
    this.name = 'CalendarAuthError'
  }
}

export class CalendarEventNotFoundError extends Error {
  constructor() {
    super('Google Calendar event no longer exists')
    this.name = 'CalendarEventNotFoundError'
  }
}

export class CalendarProviderError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Google Calendar request failed (${status})`)
    this.name = 'CalendarProviderError'
    this.status = status
  }
}
