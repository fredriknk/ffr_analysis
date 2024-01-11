import tkinter as tk
from tkinter import ttk
import pickle
import pandas as pd
from pandas.api.types import is_numeric_dtype, is_datetime64_any_dtype

class SpecificOptionsPopup:
    def __init__(self, master, specific_options, on_select_callback):
        self.top = tk.Toplevel(master)
        self.specific_options = specific_options
        self.on_select_callback = on_select_callback
        self.create_widgets()

    def create_widgets(self):
        # Search bar
        self.search_var = tk.StringVar()
        self.search_var.trace("w", lambda name, index, mode, sv=self.search_var: self.update_table())
        tk.Entry(self.top, textvariable=self.search_var).pack()

        # Determine if specific_options is a DataFrame or dict and set up columns
        if isinstance(self.specific_options, pd.DataFrame):
            columns = tuple(self.specific_options.columns)
        else:  # It's a dict
            columns = ('Key',) + tuple(next(iter(self.specific_options.values())).keys())

        # Treeview
        self.tree = ttk.Treeview(self.top, columns=columns, show='headings')
        for col in self.tree['columns']:
            self.tree.heading(col, text=col, command=lambda _col=col: self.treeview_sort_column(_col, False))
            self.tree.column(col, anchor=tk.W)

        # Scrollbar
        scrollbar = ttk.Scrollbar(self.top, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')

        self.tree.pack(expand=True, fill='both')
        self.update_table()

        self.tree.bind("<<TreeviewSelect>>", self.on_tree_select)

    def update_table(self):
        search_term = self.search_var.get().lower()
        for i in self.tree.get_children():
            self.tree.delete(i)

        if isinstance(self.specific_options, pd.DataFrame):
            self.update_table_from_dataframe(search_term)
        else:
            self.update_table_from_dict(search_term)

    def update_table_from_dict(self, search_term):
        for key, values in self.specific_options.items():
            if search_term in key.lower():
                row_data = [values[col] for col in self.tree['columns'][1:]]  # Skip the first 'Key' column
                self.tree.insert('', tk.END, values=[key] + row_data)

    def update_table_from_dataframe(self, search_term):
        for index, row in self.specific_options.iterrows():
            if search_term in str(row['Key']).lower():
                row_data = [row[col] for col in self.tree['columns']]
                self.tree.insert('', tk.END, values=row_data)

    def on_tree_select(self, event):
        selected_item = self.tree.item(self.tree.selection())
        if selected_item:
            selected_key = selected_item['values'][0]
            self.on_select_callback(selected_key)

    def treeview_sort_column(self, col, reverse):
        l = [(self.tree.set(k, col), k) for k in self.tree.get_children('')]
        l.sort(reverse=reverse)
        for index, (val, k) in enumerate(l):
            self.tree.move(k, '', index)
        self.tree.heading(col, command=lambda: self.treeview_sort_column(col, not reverse))

class Dataframe_Filter_Popup:
    def __init__(self, master, specific_options, on_select_callback):
        self.top = tk.Toplevel(master)
        self.specific_options = specific_options
        self.on_select_callback = on_select_callback
        self.filter_values = {}
        self.create_widgets()

    def create_widgets(self):
        self.search_var = tk.StringVar()
        self.search_var.trace("w", lambda name, index, mode, sv=self.search_var: self.update_table())
        tk.Entry(self.top, textvariable=self.search_var).pack()

        first_row = self.specific_options.iloc[0]

        # Create a toggle button for showing/hiding filters
        self.toggle_filters_button = tk.Button(self.top, text="Show Filters", command=self.toggle_filters)
        self.toggle_filters_button.pack()

        # Create a frame for filters, initially hidden
        self.filters_frame = tk.Frame(self.top)
        self.filters_frame.pack(fill=tk.X, expand=False)
        self.filters_visible = False  # Initially, filters are not visible

        self.apply_filters_button = tk.Button(self.top, text="Apply Filters", command=self.update_table)
        self.apply_filters_button.pack()

        row = 0
        for col in self.specific_options.columns:
            if pd.api.types.is_datetime64_any_dtype(self.specific_options[col]):
                self.add_date_range_entries(col, row)
                row += 1
            elif pd.api.types.is_numeric_dtype(self.specific_options[col]):
                self.add_min_max_entries(col, row)
                row += 1

        # Treeview setup
        # Convert column names to string and remove any special characters if needed
        column_names = ['Nr'] + list(map(str, self.specific_options.columns))
        # Treeview setup
        self.tree = ttk.Treeview(self.top, columns=column_names, show='headings')

        # Set up the treeview style for gridlines and alternating row colors
        style = ttk.Style()
        style.configure("Treeview", background="white", foreground="black", rowheight=25)
        style.configure("Treeview.Heading", font=('Calibri', 10, 'bold'))
        style.map('Treeview', background=[('selected', 'blue')])
        style.layout("Treeview", [('Treeview.treearea', {'sticky': 'nswe'})])  # Remove borders
        # Alternating row tags
        self.tree.tag_configure('oddrow', background='lightgrey')
        self.tree.tag_configure('evenrow', background='white')

        # Set up the headings and columns
        for col_name in column_names:
            self.tree.heading(col_name, text=col_name)
            self.tree.column(col_name, anchor=tk.W)

        scrollbar = ttk.Scrollbar(self.top, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side='right', fill='y')
        self.tree.pack(fill=tk.BOTH, expand=True)

        self.tree.bind("<<TreeviewSelect>>", self.on_tree_select)
        self.update_table()
    def toggle_filters(self):
        # Toggle the visibility of the filters frame
        if self.filters_visible:
            self.filters_frame.pack_forget()
            self.toggle_filters_button.config(text="Show Filters")
        else:
            self.filters_frame.pack(fill=tk.X, expand=False)
            self.toggle_filters_button.config(text="Hide Filters")
        self.filters_visible = not self.filters_visible
    def add_min_max_entries(self, col, row):
        tk.Label(self.filters_frame, text=f"{col} Min:").grid(row=row, column=0)
        min_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=min_var).grid(row=row, column=1)

        tk.Label(self.filters_frame, text=f"{col} Max:").grid(row=row, column=2)
        max_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=max_var).grid(row=row, column=3)

        self.filter_values[col] = {'min': min_var, 'max': max_var}

    def add_date_range_entries(self, col, row):
        tk.Label(self.filters_frame, text=f"{col} Start:").grid(row=row, column=0)
        start_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=start_var).grid(row=row, column=1)

        tk.Label(self.filters_frame, text=f"{col} End:").grid(row=row, column=2)
        end_var = tk.StringVar()
        tk.Entry(self.filters_frame, textvariable=end_var).grid(row=row, column=3)

        self.filter_values[col] = {'start': start_var, 'end': end_var}

    def update_table(self):
        # Get the search term from the search_var StringVar
        minval = 0.01
        search_term = self.search_var.get().lower()

        filtered_df = self.apply_filters()
        for i in self.tree.get_children():
            self.tree.delete(i)
        row_color_counter = 0
        # Use the first column's name as the key
        first_column_name = self.specific_options.columns[0]

        for index, row in filtered_df.iterrows():
            # Check if the search term is in the first column's value
            if search_term in str(row[first_column_name]).lower():
                # Format numbers based on their value
                row_data = [index] + [
                    f"{val:.1f}" if isinstance(val, float) and abs(val) == 0 else
                    f"{val:.0f}" if isinstance(val, int ) else
                    f"{val:.2e}" if isinstance(val, (int, float)) and abs(val) < minval else
                    f"{val:.2f}" if isinstance(val, (int, float)) else val
                    for val in row
                ]
                color_tag = 'evenrow' if row_color_counter % 2 == 0 else 'oddrow'
                self.tree.insert('', tk.END, values=row_data, tags=(color_tag,))
                row_color_counter += 1  # Increment the counter

        # Alternate row color configuration (if not done already in create_widgets)
        self.tree.tag_configure('oddrow', background='lightgrey')
        self.tree.tag_configure('evenrow', background='white')
    def apply_filters(self):
        df = self.specific_options.copy()
        for col, filters in self.filter_values.items():
            if 'min' in filters and filters['min'].get():
                df = df[df[col] >= float(filters['min'].get())]
            if 'max' in filters and filters['max'].get():
                df = df[df[col] <= float(filters['max'].get())]
            if 'start' in filters and filters['start'].get():
                df = df[df[col] >= pd.to_datetime(filters['start'].get())]
            if 'end' in filters and filters['end'].get():
                df = df[df[col] <= pd.to_datetime(filters['end'].get())]
        return df

    def on_tree_select(self, event):
        selected_item = self.tree.item(self.tree.selection())
        if selected_item:
            print(selected_item)  # This will now include the DataFrame index
            selected_index = selected_item['values'][0]  # This is the DataFrame index
            self.on_select_callback(selected_index)

class ColumnSelectionPopup:
    def __init__(self, master, all_columns, on_submit_callback, preselected_columns=None):
        self.top = tk.Toplevel(master)
        self.all_columns = all_columns
        self.preselected_columns = preselected_columns if preselected_columns is not None else []
        self.on_submit_callback = on_submit_callback
        self.selected_columns = []
        self.create_widgets()
    def create_widgets(self):
        # Determine grid layout dimensions
        num_cols = 3  # You can adjust the number of columns as needed
        num_rows = (len(self.all_columns) + num_cols - 1) // num_cols

        for index, col in enumerate(self.all_columns):
            is_checked = col in self.preselected_columns
            var = tk.BooleanVar(value=is_checked)
            chk = tk.Checkbutton(self.top, text=col, variable=var)
            # Arrange checkboxes in a grid
            chk.grid(row=index // num_cols, column=index % num_cols, sticky='w')
            self.selected_columns.append((col, var))

        # Place the submit button at the bottom of the grid
        submit_button = tk.Button(self.top, text="Submit", command=self.submit)
        submit_button.grid(row=num_rows, column=0, columnspan=num_cols)

    def submit(self):
        selected = [col for col, var in self.selected_columns if var.get()]
        self.on_submit_callback(selected)
        self.top.destroy()




# Example usage
if __name__ == "__main__":
    root = tk.Tk()
    root.withdraw()  # Hide the main window

    specific_options_filename = 'specific_options.pickle'

    with open(specific_options_filename, 'rb') as handle:
        specific_options = pickle.load(handle)

    popup = SpecificOptionsPopup(root, specific_options)
    root.mainloop()
