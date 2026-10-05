import { Select, type SelectProps } from 'antd'
import { useDeferredValue, useState } from 'react'

import { api } from '@/api/client'
import type { UserRole } from '@/api/types'

type Props = Omit<SelectProps<number>, 'options' | 'showSearch' | 'filterOption' | 'onSearch'>

export function BuildingSelect(props: Props) {
  const { data, isLoading } = api.useQuery('get', '/api/v1/buildings', {
    params: { query: { limit: 500 } },
  })
  return (
    <Select<number>
      placeholder="Дом"
      allowClear
      showSearch
      optionFilterProp="label"
      loading={isLoading}
      options={data?.items.map((b) => ({ value: b.id, label: b.address }))}
      {...props}
    />
  )
}

export function ApartmentSelect({ buildingId, ...props }: Props & { buildingId?: number }) {
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)
  const { data, isFetching } = api.useQuery('get', '/api/v1/apartments', {
    params: { query: { limit: 30, search: deferred || undefined, building_id: buildingId } },
  })
  return (
    <Select<number>
      placeholder="Помещение: номер, л/с, адрес, собственник"
      allowClear
      showSearch
      filterOption={false}
      onSearch={setSearch}
      loading={isFetching}
      options={data?.items.map((a) => ({
        value: a.id,
        label: `${a.building.address}, кв. ${a.number} (л/с ${a.account_number})`,
      }))}
      {...props}
    />
  )
}

export function UserSelect({ role, ...props }: Props & { role?: UserRole }) {
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)
  const { data, isFetching } = api.useQuery('get', '/api/v1/users', {
    params: { query: { limit: 30, role, search: deferred || undefined } },
  })
  return (
    <Select<number>
      placeholder="Пользователь"
      allowClear
      showSearch
      filterOption={false}
      onSearch={setSearch}
      loading={isFetching}
      options={data?.items.map((u) => ({ value: u.id, label: `${u.full_name} · ${u.email}` }))}
      {...props}
    />
  )
}
