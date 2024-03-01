import tkinter as tk
from tkinter import filedialog
import matplotlib.pyplot as plt
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
import pandas as pd
import numpy as np
from matplotlib.patches import Rectangle
from sklearn.decomposition import PCA

class FieldPlotter(tk.Tk):
    def __init__(self):
        super().__init__()

        self.title('Field Plotter')
        self.geometry('800x600')

        self.plot_button = tk.Button(self, text="Load and Plot Field", command=self.load_and_plot)
        self.plot_button.pack()

        self.fig, self.ax = plt.subplots()
        self.canvas = FigureCanvasTkAgg(self.fig, master=self)  # A tk.DrawingArea.
        self.canvas.draw()
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=1)

    def load_and_plot(self):
        filepath = filedialog.askopenfilename(filetypes=[("CSV files", "*.csv")])
        if filepath:
            self.plot_field(filepath)

    def plot_field(self, filepath):
        # Load data with the Z coordinate included
        data = pd.read_csv(filepath, header=None, names=['X', 'Y', "Z", 'Angle', 'Type', 'MeasureSide', 'Name'])
        measure_points = data[data['Type'] == 'Measure']

        # Plot setup
        self.ax.clear()
        self.ax.set_aspect('equal', adjustable='box')

        for index, row in measure_points.iterrows():
            angle = row['Angle']
            # Calculate offsets for the chambers based on robot orientation
            # Adjust these values as per your requirement to position one ahead and one behind
            dx_ahead = np.cos(angle) * 0.2  # 0.2m ahead
            dy_ahead = np.sin(angle) * 0.2
            dx_side = np.sin(angle) * 2  # 2m to the side
            dy_side = -np.cos(angle) * 2

            # Plot robot position with a specific marker, e.g., a black dot ('ko')
            self.ax.plot(row['X'], row['Y'], 'ko')  # Black dot for robot position

            # Add measurement number next to the robot position
            self.ax.text(row['X'], row['Y'], str(index), color='black')

            # Draw an arrow indicating the driving direction
            self.ax.arrow(row['X'], row['Y'], dx_ahead * 0.5, dy_ahead * 0.5, head_width=0.5, head_length=1.5, fc='k',
                          ec='k')

            # Adjust chamber position calculation
            if row['MeasureSide'] == 'left' or row['MeasureSide'] == 'both':
                # For left side, position the chamber
                chamber_x_left, chamber_y_left = (row['X'] - dx_side + dx_ahead, row['Y'] - dy_side + dy_ahead)
                self.ax.plot(chamber_x_left, chamber_y_left, 'gs')  # Green square for left chamber

            if row['MeasureSide'] == 'right' or row['MeasureSide'] == 'both':
                # For right side, position the chamber
                chamber_x_right, chamber_y_right = (row['X'] + dx_side + dx_ahead, row['Y'] + dy_side + dy_ahead)
                self.ax.plot(chamber_x_right, chamber_y_right, 'rs')  # Red square for right chamber

        # Apply PCA
        pca = PCA(n_components=2)
        transformed_data = pca.fit_transform(measure_points[['X', 'Y']])

        # Find the corners of the rectangle in the transformed (PCA) space
        min_x, max_x = transformed_data[:, 0].min(), transformed_data[:, 0].max()
        min_y, max_y = transformed_data[:, 1].min(), transformed_data[:, 1].max()

        # Define corners of the rectangle in PCA space
        corners_pca_space = np.array([
            [min_x, min_y],
            [min_x, max_y],
            [max_x, max_y],
            [max_x, min_y]
        ])

        # Transform the corners back to the original space
        corners_original_space = pca.inverse_transform(corners_pca_space)

        # Draw a polygon that represents the rectangle
        from matplotlib.patches import Polygon
        rectangle = Polygon(corners_original_space, closed=True, edgecolor='r', facecolor='none')
        self.ax.add_patch(rectangle)

        self.canvas.draw()


if __name__ == "__main__":
    app = FieldPlotter()
    app.mainloop()
