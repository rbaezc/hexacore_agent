import { ProjectProfile, SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

export function elixirBlueprint(n: SliceNames, p: ProjectProfile): SliceBlueprint {
  const mod = `${p.elixirModule}.${n.pascal}`;
  const web = `${p.elixirModule}Web`;
  const base = `lib/${p.elixirApp}/${n.snake}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/${n.snake}.ex`,
          role: 'domain',
          content: `defmodule ${mod}.${n.pascal} do
  @moduledoc "Domain entity of the ${n.snake} slice."
  @enforce_keys [:id, :created_at]
  defstruct [:id, :created_at]

  @type t :: %__MODULE__{id: String.t(), created_at: String.t()}
end
`,
        },
        {
          path: `${base}/repository.ex`,
          role: 'domain',
          content: `defmodule ${mod}.Repository do
  @moduledoc "Port implemented by the infrastructure layer."
  alias ${mod}.${n.pascal}

  @callback save(${n.pascal}.t()) :: :ok
  @callback find_by_id(String.t()) :: ${n.pascal}.t() | nil
end
`,
        },
      ],
      application: [
        {
          path: `${base}/${n.snake}_context.ex`,
          role: 'application',
          content: `defmodule ${mod}.${n.pascal}Context do
  @moduledoc "Use cases of the ${n.snake} slice; the repository is injected (defaults to app config)."
  alias ${mod}.${n.pascal}

  def create(id, repo \\\\ repository())

  def create(id, repo) when is_binary(id) and id != "" do
    entity = %${n.pascal}{id: id, created_at: DateTime.utc_now() |> DateTime.to_iso8601()}
    :ok = repo.save(entity)
    {:ok, entity}
  end

  def create(_id, _repo), do: {:error, "${n.pascal}: \\"id\\" is required."}

  def get(id, repo \\\\ repository()), do: repo.find_by_id(id)

  defp repository, do: Application.fetch_env!(:${p.elixirApp}, :${n.snake}_repository)
end
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/in_memory_repository.ex`,
          role: 'infrastructure',
          content: `defmodule ${mod}.InMemoryRepository do
  @moduledoc "Agent-backed repository; add it to your supervision tree."
  @behaviour ${mod}.Repository
  use Agent

  def start_link(_opts \\\\ []), do: Agent.start_link(fn -> %{} end, name: __MODULE__)

  @impl true
  def save(entity), do: Agent.update(__MODULE__, &Map.put(&1, entity.id, entity))

  @impl true
  def find_by_id(id), do: Agent.get(__MODULE__, &Map.get(&1, id))
end
`,
        },
      ],
      presentation: [
        {
          path: `lib/${p.elixirApp}_web/controllers/${n.snake}_controller.ex`,
          role: 'presentation',
          content: `defmodule ${web}.${n.pascal}Controller do
  use ${web}, :controller

  alias ${mod}.${n.pascal}Context

  def create(conn, params) do
    case ${n.pascal}Context.create(Map.get(params, "id", "")) do
      {:ok, entity} -> conn |> put_status(:created) |> json(Map.from_struct(entity))
      {:error, reason} -> conn |> put_status(:bad_request) |> json(%{error: reason})
    end
  end
end
`,
        },
      ],
    },
    module: [],
    tests: [
      {
        path: `test/${p.elixirApp}/${n.snake}/${n.snake}_context_test.exs`,
        role: 'test',
        content: `defmodule ${mod}.${n.pascal}ContextTest do
  use ExUnit.Case, async: false

  alias ${mod}.{${n.pascal}Context, InMemoryRepository}

  setup do
    start_supervised!(InMemoryRepository)
    :ok
  end

  test "creates and retrieves a ${n.snake}" do
    assert {:ok, entity} = ${n.pascal}Context.create("${n.kebab}-1", InMemoryRepository)
    assert ${n.pascal}Context.get("${n.kebab}-1", InMemoryRepository) == entity
  end

  test "rejects a missing id" do
    assert {:error, _reason} = ${n.pascal}Context.create("", InMemoryRepository)
  end
end
`,
      },
    ],
    notes: [
      `Wire the slice: add \`config :${p.elixirApp}, :${n.snake}_repository, ${mod}.InMemoryRepository\` to config/config.exs and ${mod}.InMemoryRepository to your supervision tree.`,
    ],
  };
}
