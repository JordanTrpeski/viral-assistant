import type { OrganiseModule } from "./types.js";

export const notesModule: OrganiseModule = {
  type: "note",
  label: "Notes",
  fields: ["title", "notes", "date", "project_id", "links"],
  statuses: null,
  actions: [
    {
      name: "create_note", description: "Write a note with an optional title, date, project and links to other items.",
      fieldSchema: {
        title: { type: "text", required: false, description: "Optional; the first line of the text is used otherwise" },
        notes: { type: "text", required: true, description: "Body text, up to 5000 characters" },
        date: { type: "date", required: false, description: "YYYY-MM-DD" },
        links: { type: "list", required: false, description: "Ids of existing items" }
      }
    },
    { name: "link_note", description: "Link a note to an existing item.", fieldSchema: { id: { type: "id", required: true, description: "The note" }, link: { type: "id", required: true, description: "An existing item" } } }
  ]
};
