/**
 * La retirada de marca no se expone hasta contar con un checkout Stripe
 * verificado. Este componente se mantiene como interfaz compatible, pero no
 * debe renderizar un botón que llame a un proveedor heredado.
 */
interface WatermarkRemovalButtonProps {
  appId: string;
  onRemovalSuccess?: () => void;
}

export function WatermarkRemovalButton(_props: WatermarkRemovalButtonProps) {
  return null;
}
