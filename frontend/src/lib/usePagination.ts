import type { TablePaginationConfig } from 'antd'
import { useState } from 'react'

/** Серверная пагинация для antd Table поверх limit/offset API. */
export function usePagination(defaultPageSize = 20) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  const table = (total: number | undefined): TablePaginationConfig => ({
    current: page,
    pageSize,
    total: total ?? 0,
    showSizeChanger: true,
    showTotal: (count) => `Всего: ${count}`,
    onChange: (nextPage, nextSize) => {
      setPage(nextSize !== pageSize ? 1 : nextPage)
      setPageSize(nextSize)
    },
  })

  return {
    query: { limit: pageSize, offset: (page - 1) * pageSize },
    table,
    reset: () => setPage(1),
  }
}
