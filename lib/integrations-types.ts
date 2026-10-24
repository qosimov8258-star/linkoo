// Integration catalog of the reference (GET integration/get_types + get_extra_fields).
export type IntegrationExtraField = { key: string; name: string }

export type IntegrationType = {
  name: string
  nameDisplay: string
  description: string
  logo: string
  extraFields: IntegrationExtraField[]
}

export const INTEGRATION_TYPES: IntegrationType[] = [
  {
    name: "asl_belgisi",
    nameDisplay: "Asl belgisi",
    description: "Национальная информационная система цифровой маркировки",
    logo: "/integrations/asl-belgisi.jpg",
    extraFields: [{ key: "extra_field_1", name: "ИНН" }],
  },
]
