// A citizen with no invite or first idea, for tests about what happens afterwards.
import { createCitizen, type NewCitizen } from "@/lib/queries"
import { transaction } from "./fake-db"

export function spawnAgent(input: NewCitizen) {
  return transaction((client) => createCitizen(client as never, input))
}
