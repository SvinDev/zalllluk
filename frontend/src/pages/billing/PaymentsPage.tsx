import { PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { App, Button, DatePicker, Form, Input, InputNumber, Modal, Radio, Select, Table } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { PaymentMethod, PaymentRead } from '@/api/types'
import { ACCOUNTANTS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { ApartmentSelect, BuildingSelect } from '@/components/selects'
import { dateTime, money } from '@/lib/format'
import { options, paymentMethodLabels } from '@/lib/labels'
import { usePagination } from '@/lib/usePagination'

type Values = {
  by: 'apartment' | 'account'
  apartment_id?: number
  account_number?: string
  amount: number
  paid_at?: Dayjs
  method: PaymentMethod
  reference?: string
  comment?: string
}

export default function PaymentsPage() {
  const { user, hasRole } = useAuth()
  const isStaff = user?.role !== 'resident'
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const presetApartment = params.get('apartment_id') ? Number(params.get('apartment_id')) : undefined
  const page = usePagination()
  const [buildingId, setBuildingId] = useState<number>()
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)
  // Переход из карточки помещения (?apartment_id=…) сразу открывает форму оплаты.
  const [open, setOpen] = useState(() => !!presetApartment && hasRole(...ACCOUNTANTS))
  const [form] = Form.useForm<Values>()
  const by = Form.useWatch('by', form)

  const { data, isLoading, error } = api.useQuery('get', '/api/v1/payments', {
    params: {
      query: {
        ...page.query,
        building_id: buildingId,
        date_from: range?.[0]?.format('YYYY-MM-DD'),
        date_to: range?.[1]?.format('YYYY-MM-DD'),
      },
    },
  })
  const create = api.useMutation('post', '/api/v1/payments')

  const save = async () => {
    const { by: mode, paid_at, ...v } = await form.validateFields()
    try {
      await create.mutateAsync({
        body: {
          ...v,
          apartment_id: mode === 'apartment' ? v.apartment_id : undefined,
          account_number: mode === 'account' ? v.account_number : undefined,
          paid_at: paid_at?.toISOString(),
          reference: v.reference || undefined,
        },
      })
      message.success('Оплата зарегистрирована и разнесена по квитанциям')
      setOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/payments'] }),
        queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/invoices'] }),
      ])
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title="Оплаты"
        extra={
          <>
            {isStaff && <BuildingSelect style={{ width: 240 }} value={buildingId} onChange={(v) => { setBuildingId(v); page.reset() }} />}
            <DatePicker.RangePicker format="DD.MM.YYYY" value={range} onChange={(v) => { setRange(v); page.reset() }} />
            {hasRole(...ACCOUNTANTS) && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setOpen(true) }}>
                Зарегистрировать
              </Button>
            )}
          </>
        }
      />
      <QueryError error={error} />
      <Table<PaymentRead>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items}
        pagination={page.table(data?.total)}
        scroll={{ x: 800 }}
        columns={[
          { title: 'Дата', dataIndex: 'paid_at', render: dateTime, width: 150 },
          {
            title: 'Лицевой счёт',
            render: (_, p) =>
              isStaff ? (
                <Link to={`/apartments/${p.apartment.id}`}>
                  {p.apartment.account_number} · {p.apartment.building.address}, кв. {p.apartment.number}
                </Link>
              ) : (
                `${p.apartment.building.address}, кв. ${p.apartment.number}`
              ),
          },
          { title: 'Сумма', dataIndex: 'amount', align: 'right', render: money },
          { title: 'Способ', dataIndex: 'method', render: (m: PaymentMethod) => paymentMethodLabels[m] },
          { title: 'Документ', dataIndex: 'reference' },
          { title: 'Комментарий', dataIndex: 'comment' },
        ]}
      />
      <Modal open={open} title="Регистрация оплаты" onOk={save} onCancel={() => setOpen(false)} confirmLoading={create.isPending} okText="Зарегистрировать">
        <Form form={form} layout="vertical" initialValues={{ by: 'apartment', method: 'bank', apartment_id: presetApartment }}>
          <Form.Item name="by">
            <Radio.Group
              optionType="button"
              options={[
                { value: 'apartment', label: 'Найти помещение' },
                { value: 'account', label: 'По номеру л/с' },
              ]}
            />
          </Form.Item>
          {by === 'account' ? (
            <Form.Item name="account_number" label="Лицевой счёт" rules={[{ required: true }]}><Input /></Form.Item>
          ) : (
            <Form.Item name="apartment_id" label="Помещение" rules={[{ required: true }]}><ApartmentSelect /></Form.Item>
          )}
          <Form.Item name="amount" label="Сумма, ₽" rules={[{ required: true }]}>
            <InputNumber min={0.01} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="paid_at" label="Дата оплаты" extra="По умолчанию — сейчас">
            <DatePicker showTime format="DD.MM.YYYY HH:mm" disabledDate={(d) => d.isAfter(dayjs())} />
          </Form.Item>
          <Form.Item name="method" label="Способ"><Select options={options(paymentMethodLabels)} /></Form.Item>
          <Form.Item name="reference" label="Номер платёжного документа" extra="Защищает от повторного учёта той же оплаты">
            <Input maxLength={128} />
          </Form.Item>
          <Form.Item name="comment" label="Комментарий"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
