module stg './storage.bicep' = { name: 'x' }
resource sa 'Microsoft.Storage/storageAccounts@2021-02-01' = { name: toLower('x') }
func greet(name string) string => toUpper(name)
param location string = resourceGroup().location
