import fixture from "@/test/fixtures/producthunt.json";

export type ProductHuntPost = {
  id: string;
  name: string;
  tagline: string;
  url: string;
  website?: string;
  votesCount: number;
  createdAt: string;
  description: string;
  topics: string[];
  maker?: string;
};

/**
 * Product Hunt GraphQL client.
 * Uses fixture data when PH_DEV_TOKEN is unset so M1 can ship without a live token.
 */
export async function fetchProductHuntPosts(opts?: {
  first?: number;
}): Promise<ProductHuntPost[]> {
  const token = process.env.PH_DEV_TOKEN;
  if (!token) {
    return (fixture.posts as ProductHuntPost[]).slice(0, opts?.first ?? 20);
  }

  // Live path (token provisioned later). Minimal posts query.
  const query = `
    query Posts($first: Int!) {
      posts(first: $first, order: VOTES) {
        edges {
          node {
            id
            name
            tagline
            url
            website
            votesCount
            createdAt
            description
            topics { edges { node { name } } }
            user { username }
          }
        }
      }
    }
  `;
  const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      variables: { first: opts?.first ?? 20 },
    }),
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`Product Hunt API ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: {
      posts?: {
        edges?: Array<{
          node: {
            id: string;
            name: string;
            tagline: string;
            url: string;
            website?: string;
            votesCount: number;
            createdAt: string;
            description?: string;
            topics?: { edges?: Array<{ node: { name: string } }> };
            user?: { username?: string };
          };
        }>;
      };
    };
  };
  return (json.data?.posts?.edges ?? []).map(({ node }) => ({
    id: node.id,
    name: node.name,
    tagline: node.tagline,
    url: node.url,
    website: node.website,
    votesCount: node.votesCount,
    createdAt: node.createdAt,
    description: node.description ?? node.tagline,
    topics: (node.topics?.edges ?? []).map((e) => e.node.name),
    maker: node.user?.username,
  }));
}
