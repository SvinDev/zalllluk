import { App, Checkbox, DatePicker, Form, Input, Modal, Select } from 'antd'
import { useQueryClient } from '@tanstack/react-query'
import dayjs, { type Dayjs } from 'dayjs'

import { api } from '@/api/client'
import { errorMessage } from '@/api/errors'
import type { PassDetail, PassKind } from '@/api/types'
import { useAuth } from '@/auth/useAuth'
import { options, passKindLabels } from '@/lib/labels'

import { ApartmentSelect } from './selects'

type Values = {
  apartment_id: number
  kind: PassKind
  visitor_name?: string
  vehicle_plate?: string
  comment?: string
  range: [Dayjs, Dayjs]
  is_one_time: boolean
}

export function PassCreateModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (pass: PassDetail) => void
}) {
  const [form] = Form.useForm<Values>()
  const { user } = useAuth()
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const create = api.useMutation('post', '/api/v1/passes')
  const apartments = user?.apartments ?? []
  const kind = Form.useWatch('kind', form)

  const onOk = async () => {
    const { range, ...values } = await form.validateFields()
    try {
      const created = await create.mutateAsync({
        body: { ...values, valid_from: range[0].toISOString(), valid_until: range[1].toISOString() },
      })
      await queryClient.invalidateQueries({ queryKey: ['get', '/api/v1/passes'] })
      message.success(
        created.status === 'pending' ? 'Пропуск отправлен на согласование' : 'Пропуск оформлен',
      )
      onCreated(created)
      onClose()
    } catch (e) {
      message.error(errorMessage(e))
    }
  }

  return (
    <Modal
      open={open}
      title="Заказать пропуск"
      okText="Оформить"
      onOk={onOk}
      onCancel={onClose}
      confirmLoading={create.isPending}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          kind: 'guest',
          is_one_time: true,
          range: [dayjs(), dayjs().add(1, 'day')],
          apartment_id: apartments.length === 1 ? apartments[0].id : undefined,
        }}
      >
        <Form.Item name="apartment_id" label="Помещение" rules={[{ required: true, message: 'Выберите помещение' }]}>
          {user?.role === 'resident' ? (
            <Select options={apartments.map((a) => ({ value: a.id, label: `${a.building.address}, кв. ${a.number}` }))} />
          ) : (
            <ApartmentSelect />
          )}
        </Form.Item>
        <Form.Item name="kind" label="Тип">
          <Select options={options(passKindLabels)} />
        </Form.Item>
        <Form.Item name="visitor_name" label="Кто придёт / приедет">
          <Input maxLength={255} placeholder="ФИО гостя, компания доставки" />
        </Form.Item>
        <Form.Item
          name="vehicle_plate"
          label="Госномер"
          rules={[{ required: kind === 'vehicle', message: 'Для автомобиля нужен госномер' }]}
        >
          <Input maxLength={20} placeholder="А123ВС777" style={{ textTransform: 'uppercase' }} />
        </Form.Item>
        <Form.Item name="range" label="Срок действия" rules={[{ required: true }]}>
          <DatePicker.RangePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="is_one_time"
          valuePropName="checked"
          extra="Разовый пропуск до суток оформляется сразу, остальные согласует УК"
        >
          <Checkbox>Разовый проход</Checkbox>
        </Form.Item>
        <Form.Item name="comment" label="Комментарий для охраны">
          <Input.TextArea rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
