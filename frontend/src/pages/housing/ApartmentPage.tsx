import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Skeleton,
  Statistic,
  Table,
  Tabs,
} from 'antd'
import type { Dayjs } from 'dayjs'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { MeterKind, MeterRead } from '@/api/types'
import { ACCOUNTANTS, MANAGERS, useAuth } from '@/auth/useAuth'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/QueryError'
import { StatusTag } from '@/components/StatusTag'
import { SubmitReadingModal } from '@/components/SubmitReadingModal'
import { UserSelect } from '@/components/selects'
import { date, dateTime, isDebt, money, period, quantity } from '@/lib/format'
import { invoiceStatuses, meterKindLabels, options, paymentMethodLabels, ticketStatuses } from '@/lib/labels'

type MeterValues = {
  kind: MeterKind
  serial_number: string
  external_id?: string
  installed_at?: Dayjs
  verification_due?: Dayjs
  initial_value?: number
}

export default function ApartmentPage() {
  const id = Number(useParams().id)
  const { hasRole } = useAuth()
  const isManager = hasRole(...MANAGERS)
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const [meterForReading, setMeterForReading] = useState<MeterRead | null>(null)
  const [meterModal, setMeterModal] = useState(false)
  const [editModal, setEditModal] = useState(false)
  const [residentId, setResidentId] = useState<number>()
  const [meterForm] = Form.useForm<MeterValues>()
  const [editForm] = Form.useForm()

  const path = { params: { path: { apartment_id: id } } }
  const apartment = api.useQuery('get', '/api/v1/apartments/{apartment_id}', path)
  const summary = api.useQuery('get', '/api/v1/billing/accounts/{apartment_id}', path)
  const meters = api.useQuery('get', '/api/v1/meters', { params: { query: { apartment_id: id, limit: 100 } } })
  const invoices = api.useQuery('get', '/api/v1/invoices', { params: { query: { apartment_id: id, limit: 12 } } })
  const payments = api.useQuery('get', '/api/v1/payments', { params: { query: { apartment_id: id, limit: 12 } } })
  const tickets = api.useQuery('get', '/api/v1/tickets', { params: { query: { apartment_id: id, limit: 50 } } })

  const addResident = api.useMutation('post', '/api/v1/apartments/{apartment_id}/residents')
  const removeResident = api.useMutation('delete', '/api/v1/apartments/{apartment_id}/residents/{user_id}')
  const updateApartment = api.useMutation('patch', '/api/v1/apartments/{apartment_id}')
  const createMeter = api.useMutation('post', '/api/v1/meters')

  const refreshApartment = () =>
    queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/apartments/{apartment_id}'] })

  if (apartment.isLoading) return <Skeleton active />
  if (apartment.error || !apartment.data) return <QueryError error={apartment.error} />
  const a = apartment.data
  const balance = summary.data?.balance

  const saveMeter = async () => {
    const v = await meterForm.validateFields()
    try {
      await createMeter.mutateAsync({
        body: {
          apartment_id: id,
          kind: v.kind,
          serial_number: v.serial_number,
          external_id: v.external_id || undefined,
          installed_at: v.installed_at?.format('YYYY-MM-DD'),
          verification_due: v.verification_due?.format('YYYY-MM-DD'),
          initial_value: v.initial_value ?? 0,
        },
      })
      message.success('Счётчик зарегистрирован')
      setMeterModal(false)
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/meters'] })
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  const saveApartment = async () => {
    const values = await editForm.validateFields()
    try {
      await updateApartment.mutateAsync({ ...path, body: values })
      setEditModal(false)
      await refreshApartment()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <>
      <PageHeader
        title={`${a.building.address}, кв. ${a.number}`}
        subtitle={`Лицевой счёт ${a.account_number}`}
        extra={
          isManager && (
            <Button icon={<EditOutlined />} onClick={() => { editForm.setFieldsValue({ ...a, area: Number(a.area) }); setEditModal(true) }}>
              Изменить
            </Button>
          )
        }
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card>
            <Descriptions column={{ xs: 1, sm: 2 }} size="small">
              <Descriptions.Item label="Собственник">{a.owner_name ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="Площадь">{quantity(a.area, 'м²')}</Descriptions.Item>
              <Descriptions.Item label="Проживает">{a.residents_count} чел.</Descriptions.Item>
              <Descriptions.Item label="Дом">
                <Link to={`/apartments?building_id=${a.building_id}`}>{a.building.address}</Link>
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card>
            <Statistic
              title={isDebt(balance) ? 'Задолженность' : 'Переплата / баланс'}
              value={money(Math.abs(Number(balance ?? 0)))}
              valueStyle={{ color: isDebt(balance) ? '#cf1322' : '#3f8600' }}
              loading={summary.isLoading}
            />
          </Card>
        </Col>
      </Row>

      <Tabs
        style={{ marginTop: 16 }}
        items={[
          {
            key: 'meters',
            label: `Счётчики (${meters.data?.total ?? 0})`,
            children: (
              <Card
                extra={isManager && <Button icon={<PlusOutlined />} onClick={() => { meterForm.resetFields(); setMeterModal(true) }}>Счётчик</Button>}
              >
                <Table<MeterRead>
                  rowKey="id"
                  size="small"
                  pagination={false}
                  loading={meters.isLoading}
                  dataSource={meters.data?.items}
                  scroll={{ x: 700 }}
                  columns={[
                    { title: 'Тип', dataIndex: 'kind', render: (k: MeterKind) => meterKindLabels[k] },
                    { title: 'Заводской №', dataIndex: 'serial_number' },
                    { title: 'Поверка до', dataIndex: 'verification_due', render: date },
                    { title: 'Последнее показание', render: (_, m) => m.last_reading ? `${quantity(m.last_reading.value, m.unit)} · ${dateTime(m.last_reading.taken_at)}` : '—' },
                    { key: 'a', render: (_, m) => <Button size="small" onClick={() => setMeterForReading(m)} disabled={!m.is_active}>Внести показание</Button> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'invoices',
            label: 'Квитанции',
            children: (
              <Table
                rowKey="id"
                size="small"
                loading={invoices.isLoading}
                dataSource={invoices.data?.items}
                pagination={false}
                columns={[
                  { title: 'Период', dataIndex: 'period', render: (p, i) => <Link to={`/invoices/${i.id}`}>{period(p)}</Link> },
                  { title: 'Начислено', dataIndex: 'amount', align: 'right', render: money },
                  { title: 'К оплате', dataIndex: 'total_due', align: 'right', render: money },
                  { title: 'Оплачено', dataIndex: 'paid_amount', align: 'right', render: money },
                  { title: 'Статус', dataIndex: 'status', render: (s) => <StatusTag value={s} map={invoiceStatuses} /> },
                ]}
              />
            ),
          },
          {
            key: 'payments',
            label: 'Оплаты',
            children: (
              <Table
                rowKey="id"
                size="small"
                loading={payments.isLoading}
                dataSource={payments.data?.items}
                pagination={false}
                columns={[
                  { title: 'Дата', dataIndex: 'paid_at', render: dateTime },
                  { title: 'Сумма', dataIndex: 'amount', align: 'right', render: money },
                  { title: 'Способ', dataIndex: 'method', render: (m: keyof typeof paymentMethodLabels) => paymentMethodLabels[m] },
                  { title: 'Документ', dataIndex: 'reference' },
                ]}
                footer={() => hasRole(...ACCOUNTANTS) && <Link to={`/payments?apartment_id=${id}`}>Зарегистрировать оплату</Link>}
              />
            ),
          },
          {
            key: 'residents',
            label: `Жители в кабинете (${a.residents.length})`,
            children: (
              <Card>
                {isManager && (
                  <Flex gap={8} style={{ marginBottom: 16 }} wrap>
                    <UserSelect role="resident" style={{ minWidth: 320 }} value={residentId} onChange={setResidentId} />
                    <Button
                      type="primary"
                      disabled={!residentId}
                      loading={addResident.isPending}
                      onClick={async () => {
                        try {
                          await addResident.mutateAsync({ ...path, body: { user_id: residentId! } })
                          setResidentId(undefined)
                          await refreshApartment()
                        } catch (e) {
                          message.error(errorMessage(e))
                        }
                      }}
                    >
                      Привязать
                    </Button>
                  </Flex>
                )}
                <List
                  dataSource={a.residents}
                  locale={{ emptyText: 'Никто из жителей не привязан к помещению' }}
                  renderItem={(r) => (
                    <List.Item
                      actions={
                        isManager
                          ? [
                              <Popconfirm
                                key="unlink"
                                title="Отвязать жителя?"
                                onConfirm={async () => {
                                  await removeResident.mutateAsync({ params: { path: { apartment_id: id, user_id: r.id } } })
                                  await refreshApartment()
                                }}
                              >
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
                      <List.Item.Meta title={r.full_name} description={[r.email, r.phone].filter(Boolean).join(' · ')} />
                    </List.Item>
                  )}
                />
              </Card>
            ),
          },
          {
            key: 'tickets',
            label: 'Заявки',
            children: (
              <Table
                rowKey="id"
                size="small"
                loading={tickets.isLoading}
                dataSource={tickets.data?.items}
                pagination={false}
                columns={[
                  { title: '№', dataIndex: 'id', width: 70, render: (n) => <Link to={`/tickets/${n}`}>{n}</Link> },
                  { title: 'Тема', dataIndex: 'subject' },
                  { title: 'Создана', dataIndex: 'created_at', render: dateTime },
                  { title: 'Статус', dataIndex: 'status', render: (s) => <StatusTag value={s} map={ticketStatuses} /> },
                ]}
              />
            ),
          },
        ]}
      />

      <SubmitReadingModal meter={meterForReading} allowBackdate onClose={() => setMeterForReading(null)} />

      <Modal open={meterModal} title="Новый счётчик" onOk={saveMeter} onCancel={() => setMeterModal(false)} confirmLoading={createMeter.isPending} okText="Зарегистрировать">
        <Form form={meterForm} layout="vertical">
          <Form.Item name="kind" label="Тип" rules={[{ required: true }]}><Select options={options(meterKindLabels)} /></Form.Item>
          <Form.Item name="serial_number" label="Заводской номер" rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
          <Form.Item name="external_id" label="ID во внешней системе (АСКУЭ)" extra="Для автоматического приёма показаний по API">
            <Input maxLength={128} />
          </Form.Item>
          <Flex gap={12}>
            <Form.Item name="installed_at" label="Установлен"><DatePicker format="DD.MM.YYYY" /></Form.Item>
            <Form.Item name="verification_due" label="Поверка до"><DatePicker format="DD.MM.YYYY" /></Form.Item>
          </Flex>
          <Form.Item name="initial_value" label="Начальное показание"><InputNumber min={0} precision={3} style={{ width: '100%' }} /></Form.Item>
        </Form>
      </Modal>

      <Modal open={editModal} title="Помещение" onOk={saveApartment} onCancel={() => setEditModal(false)} confirmLoading={updateApartment.isPending} okText="Сохранить">
        <Form form={editForm} layout="vertical">
          <Form.Item name="number" label="Номер" rules={[{ required: true }]}><Input maxLength={20} /></Form.Item>
          <Form.Item name="account_number" label="Лицевой счёт" rules={[{ required: true }]}><Input maxLength={32} /></Form.Item>
          <Form.Item name="area" label="Площадь, м²" rules={[{ required: true }]}><InputNumber min={0.01} precision={2} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="residents_count" label="Проживает"><InputNumber min={0} max={100} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="owner_name" label="Собственник"><Input maxLength={255} /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
