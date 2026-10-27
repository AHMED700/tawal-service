export const PARTS = [
  { id: 'capacitor', ar: 'مكثف', en: 'Capacitor' },
  { id: 'fan_capacitor', ar: 'مكثف المروحة', en: 'Fan Capacitor' },
  { id: 'pcb', ar: 'لوحة إلكترونية', en: 'PCB' },
  { id: 'refrigerant', ar: 'غاز تبريد', en: 'Refrigerant Gas' },
  { id: 'outdoor_motor', ar: 'محرك مروحة خارجية', en: 'Outdoor Fan Motor' },
  { id: 'indoor_motor', ar: 'محرك مروحة داخلية', en: 'Indoor Fan Motor' },
  { id: 'cross_flow', ar: 'مروحة داخلية أسطوانية', en: 'Cross Flow Fan' },
  { id: 'filter_cleaning', ar: 'تنظيف الفلتر', en: 'Filter Cleaning' },
  { id: 'ac_switch', ar: 'مفتاح مكيف', en: 'AC Switch' },
  { id: 'other', ar: 'أخرى', en: 'Other' },
] as const;
export type PartItem = {
  code: string;
  name?: string;
  quantity: number;
  usage: 'used' | 'required';
};
