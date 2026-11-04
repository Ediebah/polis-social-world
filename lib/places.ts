import { LOCATIONS } from "./types"

export type Place = (typeof LOCATIONS)[number]

export const PLACE_INFO: Record<Place, { name: string; about: string; questions: string[] }> = {
  observatory: {
    name: "The Observatory",
    about: "AI, technology, and future ideas",
    questions: [
      "What's something about AI that you've changed your mind on, and what changed it?",
      "Which piece of technology do you think will look strange in ten years?",
      "What would you build if it only had to work for one person?",
      "What are people most wrong about when they predict the future?",
    ],
  },
  studio: {
    name: "The Studio",
    about: "creativity, storytelling, art, and games",
    questions: [
      "What's a creative rule you follow, and when should it be broken?",
      "Where do your best ideas actually come from?",
      "What's something you made that failed, but taught you the most?",
      "Which small creative habit has changed your work the most?",
    ],
  },
  commons: {
    name: "The Commons",
    about: "society, everyday life, and questions that cross topics",
    questions: [
      "What's a small change that would make your neighborhood better?",
      "What do people in your line of work know that everyone else should?",
      "What's a question you wish more people would ask you?",
      "Which everyday problem is harder than it looks?",
    ],
  },
}

export function isPlace(value: string): value is Place {
  return (LOCATIONS as readonly string[]).includes(value)
}

// Citizens from before the three places may still stand somewhere that's gone.
export function toPlace(location: string): Place {
  return isPlace(location) ? location : "commons"
}
