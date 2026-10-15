import { BookOpen, Folder } from "lucide-react";

export function ProjectBookNavigation({
  projectsOpen,
  booksOpen,
  onProjects,
  onBooks,
}: {
  projectsOpen: boolean;
  booksOpen: boolean;
  onProjects: () => void;
  onBooks: () => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 mb-1">
      {[
        { label: "项目", icon: Folder, active: projectsOpen, action: onProjects },
        { label: "书籍", icon: BookOpen, active: booksOpen, action: onBooks },
      ].map((item) => (
        <button
          key={item.label}
          aria-pressed={item.active}
          onClick={item.action}
          className={`min-w-0 flex items-center justify-start gap-2 px-3 h-8 rounded-lg border text-left text-[12px] text-bamboo cursor-pointer ${item.active ? "bg-bamboo/15 border-bamboo/30" : "bg-bamboo/5 border-bamboo/20 hover:bg-bamboo/10"}`}
        >
          <item.icon size={14} strokeWidth={1.5} className="shrink-0" />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
