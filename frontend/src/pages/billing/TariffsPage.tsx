import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { MeterKind, TariffMethod, TariffRead } from '@/api/types'
import { ACCOUNTANTS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { BuildingSelect } from '@/components/selects'
import { date } from '@/lib/format'
import { meterKindLabels, options, tariffMethodLabels } from '@/lib/labels'

type Values = {
  name: string
  method: TariffMethod
  meter_kind?: MeterKind
  rate: number
  normative?: number
  building_id?: number
  valid_from: Dayjs
  valid_to?: Dayjs
}

export default function TariffsPage() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(...ACCOUNTANTS)
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [onlyActive, setOnlyActive] = useState(true)
  const [editing, setEditing] = useState<TariffRead | 'new' | null>(null)
  const [form] = Form.useForm<Values>()
  const method = Form.useWatch('method', form)

  const tariffs = api.useQuery('get', '/api/v1/tariffs', {
    params: { query: { active_on: onlyActive ? dayjs().format('YYYY-MM-DD') : undefined } },
  })
  const buildings = api.useQuery('get', '/api/v1/buildings', { params: { query: { limit: 500 } } })
  const create = api.useMutation('post', '/api/v1/tariffs')
  const update = api.useMutation('patch', '/api/v1/tariffs/{tariff_id}')
  const buildingName = (id: number | null) =>
    id ? buildings.data?.items.find((b) => b.id === id)?.address ?? `дом #${id}` : <Tag>все дома</Tag>

  const save = async () => {
    const v = await form.validateFields()
    try {
      if (editing === 'new') {
        await create.mutateAsync({
          body: {
            ...v,
            valid_from: v.valid_from.format('YYYY-MM-DD'),
            valid_to: v.valid_to?.format('YYYY-MM-DD'),
          },
        })
      } else if (editing) {
        await update.mutateAsync({
          params: { path: { tariff_id: editing.id } },
          body: { name: v.name, rate: v.rate, normative: v.normative, valid_to: v.valid_to?.format('YYYY-MM-DD') ?? null },
        })
      }
      setEditing(null)
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/tariffs'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Тарифы и услуги"
        subtitle="Тариф применяется к месяцу, если действует на его 1-е число"
        extra={
          <>
            <Checkbox checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)}>
              Только действующие
            </Checkbox>
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ valid_from: dayjs().startOf('month') }); setEditing('new') }}>
                Добавить
              </Button>
            )}
          </>
        }
      />
      <QueryError error={tariffs.error} />
      <Table<TariffRead>
        rowKey="id"
        loading={tariffs.isLoading}
        dataSource={tariffs.data}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: 'Услуга', dataIndex: 'name' },
          { title: 'Расчёт', dataIndex: 'method', render: (m: TariffMethod, t) => (t.meter_kind ? `${tariffMethodLabels[m]}: ${meterKindLabels[t.meter_kind].toLowerCase()}` : tariffMethodLabels[m]) },
          { title: 'Ставка', dataIndex: 'rate', align: 'right', render: (r, t) => `${Number(r).toLocaleString('ru-RU')} ₽ / ${t.unit}` },
          { title: 'Норматив', dataIndex: 'normative', align: 'right', render: (n, t) => (n ? `${Number(n).toLocaleString('ru-RU')} ${t.unit}/чел.` : '—') },
          { title: 'Дома', dataIndex: 'building_id', render: buildingName },
          { title: 'Действует', render: (_, t) => `с ${date(t.valid_from)}${t.valid_to ? ` по ${date(t.valid_to)}` : ''}` },
          ...(canEdit
            ? [{
                key: 'edit',
                width: 60,
                render: (_: unknown, t: TariffRead) => (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      form.setFieldsValue({
                        name: t.name,
                        method: t.method,
                        meter_kind: t.meter_kind ?? undefined,
                        rate: Number(t.rate),
                        normative: t.normative ? Number(t.normative) : undefined,
                        building_id: t.building_id ?? undefined,
                        valid_from: dayjs(t.valid_from),
                        valid_to: t.valid_to ? dayjs(t.valid_to) : undefined,
                      })
                      setEditing(t)
                    }}
                  />
                ),
              }]
            : []),
        ]}
      />
      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'Новый тариф' : 'Тариф'}
        onOk={save}
        onCancel={() => setEditing(null)}
        confirmLoading={create.isPending || update.isPending}
        okText="Сохранить"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Услуга" rules={[{ required: true }]}><Input maxLength={255} /></Form.Item>
          <Form.Item name="method" label="Способ расчёта" rules={[{ required: true }]} extra={editing !== 'new' && 'Способ, тип счётчика, дом и дату начала изменить нельзя — заведите новый тариф'}>
            <Select options={options(tariffMethodLabels)} disabled={editing !== 'new'} />
          </Form.Item>
          {method === 'metered' && (
            <Form.Item name="meter_kind" label="Тип счётчика" rules={[{ required: true }]}>
              <Select options={options(meterKindLabels)} disabled={editing !== 'new'} />
            </Form.Item>
          )}
          <Form.Item name="rate" label="Ставка, ₽ за единицу" rules={[{ required: true }]}>
            <InputNumber min={0} precision={4} style={{ width: '100%' }} />
          </Form.Item>
          {method === 'metered' && (
            <Form.Item name="normative" label="Норматив потребления на 1 человека в месяц" extra="Используется, если нет счётчика или истории показаний">
              <InputNumber min={0} precision={4} style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="building_id" label="Дом" extra="Пусто — для всех домов">
            <BuildingSelect disabled={editing !== 'new'} />
          </Form.Item>
          <Form.Item name="valid_from" label="Действует с" rules={[{ required: true }]}>
            <DatePicker format="DD.MM.YYYY" disabled={editing !== 'new'} />
          </Form.Item>
          <Form.Item name="valid_to" label="Действует по">
            <DatePicker format="DD.MM.YYYY" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
