import { ProjectSeed, IProjectSeed } from "@workspace/db/schema";

export async function createProjectSeed(seedData: Partial<IProjectSeed>): Promise<IProjectSeed> {
  const newSeed = new ProjectSeed(seedData);
  return newSeed.save();
}

export async function getProjectSeedById(id: string): Promise<IProjectSeed | null> {
  return ProjectSeed.findById(id).exec();
}

export async function getProjectSeeds(query: any = {}): Promise<IProjectSeed[]> {
  return ProjectSeed.find(query).exec();
}

export async function updateProjectSeed(id: string, updateData: Partial<IProjectSeed>): Promise<IProjectSeed | null> {
  return ProjectSeed.findByIdAndUpdate(id, updateData, { new: true }).exec();
}

export async function deleteProjectSeed(id: string): Promise<IProjectSeed | null> {
  return ProjectSeed.findByIdAndDelete(id).exec();
}

export async function bulkCreateProjectSeeds(seeds: Partial<IProjectSeed>[]): Promise<IProjectSeed[]> {
  return ProjectSeed.insertMany(seeds);
}
