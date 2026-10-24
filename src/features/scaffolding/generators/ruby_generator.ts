import { SliceBlueprint, SliceNames } from '../domain/scaffold_types.js';

/** Ruby: feature folder under app/features (Zeitwerk maps it to `${n.pascal}::Domain::…`). */
export function rubyBlueprint(n: SliceNames): SliceBlueprint {
  const base = `app/features/${n.snake}`;
  return {
    layers: {
      domain: [
        {
          path: `${base}/domain/${n.snake}_entity.rb`,
          role: 'domain',
          content: `# frozen_string_literal: true

module ${n.pascal}
  module Domain
    ${n.pascal}Entity = Struct.new(:id, :created_at, keyword_init: true)
  end
end
`,
        },
      ],
      application: [
        {
          path: `${base}/application/create_${n.snake}.rb`,
          role: 'application',
          content: `# frozen_string_literal: true

require 'time'
require_relative '../domain/${n.snake}_entity'

module ${n.pascal}
  module Application
    # Depends on any repository responding to #save and #find_by_id (duck-typed port).
    class Create${n.pascal}
      def initialize(repository)
        @repository = repository
      end

      def call(id:)
        raise ArgumentError, '${n.pascal}: "id" is required.' if id.nil? || id.empty?

        entity = Domain::${n.pascal}Entity.new(id: id, created_at: Time.now.utc.iso8601)
        @repository.save(entity)
        entity
      end
    end
  end
end
`,
        },
      ],
      infrastructure: [
        {
          path: `${base}/infrastructure/in_memory_${n.snake}_repository.rb`,
          role: 'infrastructure',
          content: `# frozen_string_literal: true

module ${n.pascal}
  module Infrastructure
    class InMemory${n.pascal}Repository
      def initialize
        @store = {}
      end

      def save(entity)
        @store[entity.id] = entity
      end

      def find_by_id(id)
        @store[id]
      end
    end
  end
end
`,
        },
      ],
      presentation: [
        {
          path: `${base}/presentation/${n.snake}_controller.rb`,
          role: 'presentation',
          content: `# frozen_string_literal: true

module ${n.pascal}
  module Presentation
    class ${n.pascal}Controller < ApplicationController
      def create
        entity = ${n.pascal}::Composition.create_${n.snake}.call(id: params[:id].to_s)
        render json: entity.to_h, status: :created
      end
    end
  end
end
`,
        },
      ],
    },
    module: [
      {
        path: `${base}/composition.rb`,
        role: 'module',
        content: `# frozen_string_literal: true

require_relative 'application/create_${n.snake}'
require_relative 'infrastructure/in_memory_${n.snake}_repository'

module ${n.pascal}
  # Composition root of the ${n.snake} slice.
  module Composition
    def self.repository
      @repository ||= Infrastructure::InMemory${n.pascal}Repository.new
    end

    def self.create_${n.snake}
      Application::Create${n.pascal}.new(repository)
    end
  end
end
`,
      },
    ],
    tests: [
      {
        path: `spec/features/${n.snake}/create_${n.snake}_spec.rb`,
        role: 'test',
        content: `# frozen_string_literal: true

require_relative '../../../app/features/${n.snake}/application/create_${n.snake}'
require_relative '../../../app/features/${n.snake}/infrastructure/in_memory_${n.snake}_repository'

RSpec.describe ${n.pascal}::Application::Create${n.pascal} do
  let(:repository) { ${n.pascal}::Infrastructure::InMemory${n.pascal}Repository.new }

  it 'creates and stores a ${n.snake}' do
    entity = described_class.new(repository).call(id: '${n.kebab}-1')
    expect(repository.find_by_id('${n.kebab}-1')).to eq(entity)
  end

  it 'rejects a missing id' do
    expect { described_class.new(repository).call(id: '') }.to raise_error(ArgumentError, /"id" is required/)
  end
end
`,
      },
    ],
    notes: [],
  };
}
