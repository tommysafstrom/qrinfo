import PageForm from "../../PageForm";

export default function NewPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Ny infosida</h1>
      <div className="mt-6">
        <PageForm mode="new" />
      </div>
    </div>
  );
}
