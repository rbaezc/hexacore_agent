defmodule ShopWeb do
  @moduledoc "Minimal stand-in for a Phoenix web module (no Phoenix dependency in the e2e fixture)."
  def controller do
    quote do
      import ShopWeb.ControllerStubs
    end
  end

  defmacro __using__(which) when is_atom(which), do: apply(__MODULE__, which, [])
end

defmodule ShopWeb.ControllerStubs do
  @moduledoc false
  def json(conn, data), do: Map.put(conn, :resp_body, data)
  def put_status(conn, status), do: Map.put(conn, :status, status)
end
