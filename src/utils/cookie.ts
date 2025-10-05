/**
 * Cookie management utilities with safe error handling
 */

/**
 * Parse a cookie string and return a map of key-value pairs
 * @param cookieString - The document.cookie string
 * @returns Map of cookie name to value
 */
export function parseCookies(cookieString: string): Record<string, string> {
  const cookies: Record<string, string> = {}
  if (!cookieString) return cookies
  
  try {
    cookieString.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.split('=')
      if (name && rest.length > 0) {
        cookies[name.trim()] = decodeURIComponent(rest.join('=').trim())
      }
    })
  } catch {
    // Ignore parsing errors
  }
  
  return cookies
}

/**
 * Safely get a cookie value by name
 * @param name - Cookie name
 * @param defaultValue - Default value if cookie doesn't exist
 * @returns Cookie value or defaultValue
 */
export function getCookie(name: string, defaultValue?: string): string | undefined {
  if (typeof document === 'undefined') return defaultValue
  
  try {
    const regex = new RegExp('(?:^|; )' + name + '=([^;]+)')
    const match = regex.exec(document.cookie)
    return match ? decodeURIComponent(match[1]) : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Safely set a cookie
 * @param name - Cookie name
 * @param value - Cookie value
 * @param options - Cookie options (maxAge, path, domain, secure, sameSite)
 * @returns true if successful, false otherwise
 */
export function setCookie(
  name: string,
  value: string,
  options: {
    maxAge?: number // seconds
    path?: string
    domain?: string
    secure?: boolean
    sameSite?: 'Strict' | 'Lax' | 'None'
  } = {}
): boolean {
  if (typeof document === 'undefined') return false
  
  try {
    const {
      maxAge,
      path = '/',
      domain,
      secure,
      sameSite,
    } = options
    
    let cookieString = `${name}=${encodeURIComponent(value)}`
    
    if (path) cookieString += `; path=${path}`
    if (maxAge !== undefined) cookieString += `; max-age=${maxAge}`
    if (domain) cookieString += `; domain=${domain}`
    if (secure) cookieString += '; secure'
    if (sameSite) cookieString += `; samesite=${sameSite}`
    
    document.cookie = cookieString
    return true
  } catch {
    return false
  }
}

/**
 * Remove a cookie by setting its max-age to 0
 * @param name - Cookie name
 * @param options - Cookie options (must match the original cookie's path and domain)
 * @returns true if successful, false otherwise
 */
export function removeCookie(
  name: string,
  options: { path?: string; domain?: string } = {}
): boolean {
  return setCookie(name, '', { ...options, maxAge: 0 })
}
/**
 * Safe localStorage wrapper utilities with SSR support and error handling.
 * All methods gracefully handle:
 * - Server-side rendering (no window object)
 * - Storage quota exceeded
 * - Disabled localStorage (private browsing)
 * - Invalid JSON
 */

/**
 * Safely check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const test = '__ls_test__'
    window.localStorage.setItem(test, test)
    window.localStorage.removeItem(test)
    return true
  } catch {
    return false
  }
}

/**
 * Safely get an item from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Value to return if key doesn't exist or on error
 * @returns The stored value or defaultValue
 */
export function getLocalStorage<T = string>(key: string, defaultValue?: T): T | undefined {
  if (!isLocalStorageAvailable()) return defaultValue
  try {
    const raw = window.localStorage.getItem(key)
    return raw !== null ? (raw as unknown as T) : defaultValue
  } catch {
    return defaultValue
  }
}

/**
 * Safely get and parse JSON from localStorage
 * @param key - The localStorage key
 * @param defaultValue - Value to return if key doesn't exist or parsing fails
 * @returns Parsed object or defaultValue
 */
export function getLocalStorageJSON<T>(key: string, defaultValue?: T): T | undefined {
  if (!isLocalStorageAvailable()) return defaultValue
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

/**
 * Safely set an item in localStorage
 * @param key - The localStorage key
 * @param value - The value to store (will be converted to string)
 * @returns true if successful, false otherwise
 */
export function setLocalStorage(key: string, value: string): boolean {
  if (!isLocalStorageAvailable()) return false
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/**
 * Safely set an object in localStorage as JSON
 * @param key - The localStorage key
 * @param value - The object to store
 * @returns true if successful, false otherwise
 */
export function setLocalStorageJSON<T>(key: string, value: T): boolean {
  if (!isLocalStorageAvailable()) return false
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/**
 * Safely remove an item from localStorage
 * @param key - The localStorage key
 * @returns true if successful, false otherwise
 */
export function removeLocalStorage(key: string): boolean {
  if (!isLocalStorageAvailable()) return false
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

/**
 * Safely clear all localStorage
 * @returns true if successful, false otherwise
 */
export function clearLocalStorage(): boolean {
  if (!isLocalStorageAvailable()) return false
  try {
    window.localStorage.clear()
    return true
  } catch {
    return false
  }
}

