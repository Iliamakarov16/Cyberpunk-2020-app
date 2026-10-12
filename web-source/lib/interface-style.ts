export const PALETTES = ['carmine','ultraviolet','amber','maelstrom','original'] as const;
export const TREATMENTS = ['clean','printed','raw'] as const;
export const BOOT_VARIANTS = ['channel','stream','signature'] as const;
export type InterfaceStyle = {
  palette: typeof PALETTES[number];
  treatment: typeof TREATMENTS[number];
  digital: boolean;
  bootEnabled: boolean;
  bootVariant: typeof BOOT_VARIANTS[number];
};
export const STYLE_KEY = 'nc20.interface.v1';
export const DEFAULT_INTERFACE_STYLE: InterfaceStyle = {palette:'carmine',treatment:'printed',digital:true,bootEnabled:true,bootVariant:'channel'};
export function interfaceStyle(value: unknown): InterfaceStyle {
  const raw = value && typeof value === 'object' ? value as Record<string,unknown> : {};
  return {
    palette: PALETTES.includes(raw.palette as InterfaceStyle['palette']) ? raw.palette as InterfaceStyle['palette'] : DEFAULT_INTERFACE_STYLE.palette,
    treatment: TREATMENTS.includes(raw.treatment as InterfaceStyle['treatment']) ? raw.treatment as InterfaceStyle['treatment'] : DEFAULT_INTERFACE_STYLE.treatment,
    digital: typeof raw.digital === 'boolean' ? raw.digital : DEFAULT_INTERFACE_STYLE.digital,
    bootEnabled: typeof raw.bootEnabled === 'boolean' ? raw.bootEnabled : DEFAULT_INTERFACE_STYLE.bootEnabled,
    bootVariant: BOOT_VARIANTS.includes(raw.bootVariant as InterfaceStyle['bootVariant']) ? raw.bootVariant as InterfaceStyle['bootVariant'] : DEFAULT_INTERFACE_STYLE.bootVariant,
  };
}
export function readInterfaceStyle(storage: Pick<Storage,'getItem'>): InterfaceStyle {
  try {
    const saved = storage.getItem(STYLE_KEY);
    if(saved) return interfaceStyle(JSON.parse(saved));
    // Keep the appearance chosen in the approved preview on the same device.
    const appearance = JSON.parse(storage.getItem('nc20.dossier.appearance.v1') || '{}');
    const bootVariant = JSON.parse(storage.getItem('nc20.dossier.boot.v1') || 'null');
    return interfaceStyle({...appearance,bootVariant});
  } catch { return {...DEFAULT_INTERFACE_STYLE}; }
}
