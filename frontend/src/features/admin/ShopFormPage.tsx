import { zodResolver } from '@hookform/resolvers/zod';
import {
  createShopSchema,
  fullNameSchema,
  MONEY_PATTERN,
  phoneSchema,
  usernameSchema,
  type AdminShop,
  type CreateShopInput,
  type ShopWriteResult,
  type TemporaryCredentials,
  type UpdateShopInput,
} from '@marketplace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { ImageUploadField } from '../../components/media/ImageUploadField';
import { LocationPicker, parseCoordinatePair } from '../../components/maps/LocationPicker';
import { StatusBadge } from '../../components/ui/Badge';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/Dialog';
import { Field, FormError, Input, Switch, Textarea } from '../../components/ui/Form';
import { ErrorState, LoadingState, PageHeader } from '../../components/ui/States';
import { useToast } from '../../components/ui/Toast';
import { api, errorMessage } from '../../lib/api';
import { applyServerErrors } from '../../lib/forms';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';
import { invalidateAdminData, useAdminShop } from './queries';

const fields = createShopSchema.shape;
const uploadedImageSchema = z.object({ publicId: z.string(), url: z.string() });

const shopFormSchema = z.object({
  merchantFullName: fullNameSchema,
  merchantUsername: usernameSchema,
  merchantPhone: phoneSchema,
  name: fields.name,
  description: z.string().trim().max(5000),
  phone: fields.phone,
  addressText: fields.addressText,
  latitude: fields.latitude,
  longitude: fields.longitude,
  deliveryFeeEtb: z.string().trim().regex(MONEY_PATTERN, 'Use an amount like 50 or 50.50'),
  bankName: fields.bankName,
  bankAccountName: fields.bankAccountName,
  bankAccountNumber: fields.bankAccountNumber,
  logo: uploadedImageSchema.nullable(),
  cover: uploadedImageSchema.nullable(),
  openNow: z.boolean(),
});
type ShopFormInput = z.input<typeof shopFormSchema>;
type ShopFormOutput = z.output<typeof shopFormSchema>;

const FORM_FIELDS = [
  'merchantFullName',
  'merchantUsername',
  'merchantPhone',
  'name',
  'description',
  'phone',
  'addressText',
  'latitude',
  'longitude',
  'deliveryFeeEtb',
  'bankName',
  'bankAccountName',
  'bankAccountNumber',
] as const;

const NUMERIC_FIELDS = new Set(['latitude', 'longitude', 'deliveryFeeEtb']);

function initialValues(shop?: AdminShop): ShopFormInput {
  return {
    merchantFullName: shop?.merchant.fullName ?? '',
    merchantUsername: shop?.merchant.username ?? '',
    merchantPhone: shop?.merchant.contactPhone ?? '',
    name: shop?.name ?? '',
    description: shop?.description ?? '',
    phone: shop?.phone ?? '',
    addressText: shop?.addressText ?? '',
    latitude: shop?.latitude ?? '',
    longitude: shop?.longitude ?? '',
    deliveryFeeEtb: shop?.deliveryFeeEtb ?? '0',
    bankName: shop?.bankName ?? '',
    bankAccountName: shop?.bankAccountName ?? '',
    bankAccountNumber: shop?.bankAccountNumber ?? '',
    logo: shop?.logoImageId && shop.logoUrl ? { publicId: shop.logoImageId, url: shop.logoUrl } : null,
    cover: shop?.coverImageId && shop.coverUrl ? { publicId: shop.coverImageId, url: shop.coverUrl } : null,
    openNow: true,
  };
}

/** Only the fields that actually changed, so an edit never overwrites data it did not touch. */
function changesFrom(shop: AdminShop, values: ShopFormOutput): UpdateShopInput {
  const before: Record<string, string> = {
    merchantFullName: shop.merchant.fullName,
    merchantUsername: shop.merchant.username,
    merchantPhone: shop.merchant.contactPhone ?? '',
    name: shop.name,
    description: shop.description,
    phone: shop.phone,
    addressText: shop.addressText,
    latitude: shop.latitude,
    longitude: shop.longitude,
    deliveryFeeEtb: shop.deliveryFeeEtb,
    bankName: shop.bankName,
    bankAccountName: shop.bankAccountName,
    bankAccountNumber: shop.bankAccountNumber,
  };
  const changes: Record<string, unknown> = {};
  for (const key of FORM_FIELDS) {
    if (key.startsWith('merchant')) continue;
    const next = values[key];
    const previous = before[key] ?? '';
    const same = NUMERIC_FIELDS.has(key) ? Number(next) === Number(previous) : next === previous;
    if (!same) changes[key] = next;
  }
  const merchantChanged = (['merchantFullName', 'merchantUsername', 'merchantPhone'] as const).some(
    (key) => values[key] !== (before[key] ?? ''),
  );
  if (merchantChanged) {
    changes.merchantFullName = values.merchantFullName;
    changes.merchantUsername = values.merchantUsername;
    changes.merchantPhone = values.merchantPhone;
  }
  if ('latitude' in changes || 'longitude' in changes) {
    changes.latitude = values.latitude;
    changes.longitude = values.longitude;
  }
  const logoImageId = values.logo?.publicId ?? null;
  const coverImageId = values.cover?.publicId ?? null;
  if (logoImageId !== shop.logoImageId) changes.logoImageId = logoImageId;
  if (coverImageId !== shop.coverImageId) changes.coverImageId = coverImageId;
  return changes as UpdateShopInput;
}

export function ShopFormPage() {
  const { shopId } = useParams();
  const shopQuery = useAdminShop(shopId);

  if (shopId && shopQuery.isPending) return <LoadingState />;
  if (shopId && shopQuery.isError) return <ErrorState error={shopQuery.error} onRetry={() => void shopQuery.refetch()} />;
  return <ShopForm key={shopId ?? 'new'} shop={shopQuery.data} />;
}

function ShopForm({ shop }: { shop?: AdminShop }) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<TemporaryCredentials | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ShopFormInput, unknown, ShopFormOutput>({
    resolver: zodResolver(shopFormSchema),
    defaultValues: initialValues(shop),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (shop) {
        const changes = changesFrom(shop, values);
        if (Object.keys(changes).length === 0) {
          toast.info('Nothing changed.');
          return;
        }
        const updated = await api.patch<ShopWriteResult>(`/admin/shops/${shop.id}`, changes);
        if (updated.merchantCredentials) {
          setCredentials(updated.merchantCredentials);
          invalidateAdminData(queryClient);
          return;
        }
        toast.success('Shop updated');
      } else {
        const payload: CreateShopInput = {
          merchantFullName: values.merchantFullName,
          merchantUsername: values.merchantUsername,
          merchantPhone: values.merchantPhone,
          name: values.name,
          description: values.description,
          phone: values.phone,
          addressText: values.addressText,
          latitude: values.latitude,
          longitude: values.longitude,
          deliveryFeeEtb: values.deliveryFeeEtb,
          bankName: values.bankName,
          bankAccountName: values.bankAccountName,
          bankAccountNumber: values.bankAccountNumber,
          logoImageId: values.logo?.publicId ?? null,
          coverImageId: values.cover?.publicId ?? null,
          status: values.openNow ? 'ACTIVE' : 'SUSPENDED',
        };
        const created = await api.post<ShopWriteResult>('/admin/shops', payload);
        invalidateAdminData(queryClient);
        if (created.merchantCredentials) {
          setCredentials(created.merchantCredentials);
          return;
        }
        toast.success('Shop created');
      }
      invalidateAdminData(queryClient);
      navigate('/admin/shops');
    } catch (error) {
      setFormError(applyServerErrors(error, setError, [...FORM_FIELDS]));
    }
  });

  const latitude = watch('latitude');
  const longitude = watch('longitude');

  return (
    <div>
      <Link to="/admin/shops" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-950">
        <ArrowLeft className="size-4" /> All shops
      </Link>
      <PageHeader
        title={shop ? shop.name : 'New shop'}
        description={shop ? `/${shop.slug}` : 'Register a shop and place it on the map at its real location.'}
        actions={
          shop ? (
            <>
              <StatusBadge status={shop.status} />
              {shop.status === 'ACTIVE' ? (
                <ButtonLink to={`/shops/${shop.slug}`} variant="secondary" size="sm" icon={<ExternalLink className="size-4" />} target="_blank">
                  View storefront
                </ButtonLink>
              ) : null}
            </>
          ) : null
        }
      />

      {shop ? <ShopStatusCard shop={shop} /> : null}

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <FormError message={formError} />

        <Card>
          <CardHeader title="Shop details" description="What customers see on the map and the storefront." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Shop name" required error={errors.name?.message}>
              {(field) => <Input {...field} {...register('name')} invalid={!!errors.name} />}
            </Field>
            <Field label="Merchant name" required error={errors.merchantFullName?.message}>
              {(field) => (
                <Input
                  {...field}
                  {...register('merchantFullName')}
                  autoComplete="name"
                  placeholder="Enter merchant's full name"
                  invalid={!!errors.merchantFullName}
                />
              )}
            </Field>
            <Field
              label="Merchant username"
              required
              error={errors.merchantUsername?.message}
              hint="Letters, digits and underscores. An existing merchant username is reused."
            >
              {(field) => (
                <Input {...field} {...register('merchantUsername')} autoComplete="off" invalid={!!errors.merchantUsername} />
              )}
            </Field>
            <Field label="Merchant phone" required error={errors.merchantPhone?.message} hint="Ethiopian number, e.g. 0911223344">
              {(field) => (
                <Input {...field} {...register('merchantPhone')} type="tel" inputMode="tel" invalid={!!errors.merchantPhone} />
              )}
            </Field>
            <Field label="Description" error={errors.description?.message} className="sm:col-span-2">
              {(field) => <Textarea {...field} {...register('description')} rows={3} invalid={!!errors.description} />}
            </Field>
            <Field label="Phone" required error={errors.phone?.message} hint="Ethiopian number, e.g. 0471112233">
              {(field) => <Input {...field} {...register('phone')} type="tel" inputMode="tel" invalid={!!errors.phone} />}
            </Field>
            <Field label="Address" required error={errors.addressText?.message} hint="Street, landmark or area">
              {(field) => <Input {...field} {...register('addressText')} invalid={!!errors.addressText} />}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Location" description="The pin is drawn exactly at these coordinates." />
          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_240px]">
            <LocationPicker
              latitude={latitude}
              longitude={longitude}
              onChange={(lat, lng) => {
                setValue('latitude', lat, { shouldValidate: true, shouldDirty: true });
                setValue('longitude', lng, { shouldValidate: true, shouldDirty: true });
              }}
            />
            <div className="space-y-4">
              <Field label="Latitude" required error={errors.latitude?.message}>
                {(field) => (
                  <Input
                    {...field}
                    {...register('latitude')}
                    inputMode="decimal"
                    placeholder="7.674200"
                    invalid={!!errors.latitude}
                    onPaste={(event) => {
                      const pair = parseCoordinatePair(event.clipboardData.getData('text'));
                      if (!pair) return;
                      event.preventDefault();
                      setValue('latitude', pair.latitude, { shouldValidate: true, shouldDirty: true });
                      setValue('longitude', pair.longitude, { shouldValidate: true, shouldDirty: true });
                    }}
                  />
                )}
              </Field>
              <Field label="Longitude" required error={errors.longitude?.message}>
                {(field) => (
                  <Input {...field} {...register('longitude')} inputMode="decimal" placeholder="36.834600" invalid={!!errors.longitude} />
                )}
              </Field>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Delivery and payouts"
            description="Bank details are private: only this merchant and administrators can see them."
          />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Delivery fee (ETB)" required error={errors.deliveryFeeEtb?.message} hint="Flat fee per order. Use 0 for free delivery.">
              {(field) => <Input {...field} {...register('deliveryFeeEtb')} inputMode="decimal" invalid={!!errors.deliveryFeeEtb} />}
            </Field>
            <Field label="Bank name" required error={errors.bankName?.message}>
              {(field) => <Input {...field} {...register('bankName')} placeholder="Commercial Bank of Ethiopia" invalid={!!errors.bankName} />}
            </Field>
            <Field label="Account holder name" required error={errors.bankAccountName?.message}>
              {(field) => <Input {...field} {...register('bankAccountName')} invalid={!!errors.bankAccountName} />}
            </Field>
            <Field label="Account number" required error={errors.bankAccountNumber?.message}>
              {(field) => (
                <Input {...field} {...register('bankAccountNumber')} autoComplete="off" spellCheck={false} invalid={!!errors.bankAccountNumber} />
              )}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Branding" description="Optional. JPEG, PNG or WebP up to 5 MB." />
          <div className="grid gap-6 p-5 sm:grid-cols-[auto_minmax(0,1fr)]">
            <Controller
              control={control}
              name="logo"
              render={({ field }) => (
                <ImageUploadField label="Logo" value={field.value} onChange={field.onChange} uploadPath="/admin/uploads/images" />
              )}
            />
            <Controller
              control={control}
              name="cover"
              render={({ field }) => (
                <ImageUploadField
                  label="Cover photo"
                  value={field.value}
                  onChange={field.onChange}
                  uploadPath="/admin/uploads/images"
                  aspect="wide"
                />
              )}
            />
          </div>
        </Card>

        {!shop ? (
          <Card className="p-5">
            <Controller
              control={control}
              name="openNow"
              render={({ field }) => (
                <Switch
                  label="Open to customers immediately"
                  description="Turn off to prepare the shop privately; you can open it later."
                  checked={field.value}
                  onChange={(event) => field.onChange(event.target.checked)}
                />
              )}
            />
          </Card>
        ) : null}

        <div className="flex justify-end gap-2">
          <ButtonLink to="/admin/shops" variant="secondary">
            Cancel
          </ButtonLink>
          <Button type="submit" loading={isSubmitting}>
            {shop ? 'Save changes' : 'Create shop'}
          </Button>
        </div>
      </form>
      <TemporaryPasswordDialog
        credentials={credentials}
        onClose={() => {
          setCredentials(null);
          navigate('/admin/shops');
        }}
      />
    </div>
  );
}

const STATUS_ACTIONS = {
  ACTIVE: { label: 'Open shop', description: 'Customers will see this shop on the map again.', tone: 'primary' },
  SUSPENDED: {
    label: 'Suspend shop',
    description: 'The shop disappears from the map and search until you open it again. The merchant keeps access.',
    tone: 'danger',
  },
  REMOVED: {
    label: 'Remove shop',
    description:
      'The shop is closed: hidden from customers and from the merchant dashboard. Its records are kept, and you can reopen it later.',
    tone: 'danger',
  },
} as const;

function ShopStatusCard({ shop }: { shop: AdminShop }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<keyof typeof STATUS_ACTIONS | null>(null);
  const mutation = useMutation({
    mutationFn: (status: keyof typeof STATUS_ACTIONS) => api.patch<AdminShop>(`/admin/shops/${shop.id}`, { status }),
    onSuccess: (updated) => {
      toast.success(`Shop is now ${updated.status.toLowerCase()}`);
      setTarget(null);
      invalidateAdminData(queryClient);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const options = (Object.keys(STATUS_ACTIONS) as (keyof typeof STATUS_ACTIONS)[]).filter((status) => status !== shop.status);

  return (
    <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-5">
      <div>
        <p className="text-sm font-semibold text-ink-950">Visibility</p>
        <p className="text-sm text-ink-500">
          {shop.status === 'ACTIVE'
            ? shop.merchant.status === 'ACTIVE'
              ? 'Visible to customers on the map.'
              : 'Hidden: the merchant account is suspended.'
            : shop.status === 'SUSPENDED'
              ? 'Hidden from customers.'
              : 'Removed. Hidden from customers and the merchant.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={STATUS_ACTIONS[status].tone === 'danger' ? 'secondary' : 'primary'}
            onClick={() => setTarget(status)}
          >
            {STATUS_ACTIONS[status].label}
          </Button>
        ))}
      </div>
      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={() => target && mutation.mutate(target)}
        title={target ? `${STATUS_ACTIONS[target].label}?` : ''}
        description={target ? STATUS_ACTIONS[target].description : ''}
        confirmLabel={target ? STATUS_ACTIONS[target].label : 'Confirm'}
        tone={target ? STATUS_ACTIONS[target].tone : 'primary'}
        loading={mutation.isPending}
      />
    </Card>
  );
}
