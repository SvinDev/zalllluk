type ValidationItem = { loc?: (string | number)[]; msg?: string }

/** Человекочитаемое сообщение из ответа API ({detail}) или исключения. */
export function errorMessage(error: unknown, fallback = 'Что-то пошло не так'): string {
  if (!error) return fallback
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message || fallback
  if (typeof error === 'object' && 'detail' in error) {
    const detail = (error as { detail: unknown }).detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail)) {
      return (detail as ValidationItem[])
        .map((item) => {
          const field = item.loc?.filter((part) => part !== 'body').join('.')
          const msg = item.msg?.replace(/^Value error, /, '') ?? ''
          return field ? `${field}: ${msg}` : msg
        })
        .join('; ')
    }
  }
  return fallback
}
