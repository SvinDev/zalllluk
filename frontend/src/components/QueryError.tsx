import { Alert } from 'antd'

import { errorMessage } from '@/api/errors'

export function QueryError({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <Alert type="error" showIcon message="Не удалось загрузить данные" description={errorMessage(error)} style={{ marginBottom: 16 }} />
  )
}
